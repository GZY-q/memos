package filter

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/text/cases"
	msqlite "modernc.org/sqlite"
)

var (
	testUnicodeLowerOnce sync.Once
)

// registerTestUnicodeLower registers the same memos_unicode_lower scalar the
// SQLite store installs, so filter behavioral tests can run foldedLike SQL
// without importing store/db/sqlite. Registration is global and idempotent.
func registerTestUnicodeLower(t *testing.T) {
	t.Helper()
	testUnicodeLowerOnce.Do(func() {
		fold := cases.Fold()
		// Ignore the error: a prior registration (e.g. another test package
		// in the same binary) already installed the function.
		_ = msqlite.RegisterScalarFunction("memos_unicode_lower", 1, func(_ *msqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			if len(args) == 0 || args[0] == nil {
				return nil, nil
			}
			switch v := args[0].(type) {
			case string:
				return fold.String(v), nil
			case []byte:
				return fold.String(string(v)), nil
			default:
				return v, nil
			}
		})
	})
}

func TestCompileAcceptsStandardTagEqualityPredicate(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `tags.exists(t, t == "1231")`)
	require.NoError(t, err)
}

func TestCompileRejectsLegacyNumericLogicalOperand(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `pinned && 1`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to compile filter")
}

func TestCompileRejectsNonBooleanTopLevelConstant(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `1`)
	require.EqualError(t, err, "filter must evaluate to a boolean value")
}

func TestCompileRejectsMalformedRegex(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `content.matches("(")`)
	require.Error(t, err)
}

func TestCompileMatchesRendersRegexOperator(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `content.matches("v[0-9]+")`, RenderOptions{Dialect: DialectPostgres})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "~")
	require.Equal(t, []any{"v[0-9]+"}, stmt.Args)
}

func TestCompileRejectsStartsWithOnUnsupportedField(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	_, err = engine.Compile(context.Background(), `visibility.startsWith("P")`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "does not support text matching")
}

func TestRenderSpaceFilters(t *testing.T) {
	t.Parallel()

	for _, schema := range []Schema{NewSchema(), NewAttachmentSchema()} {
		engine, err := NewEngine(schema)
		require.NoError(t, err)
		for _, dialect := range []DialectName{DialectSQLite, DialectMySQL, DialectPostgres} {
			assigned, err := engine.CompileToStatement(
				context.Background(),
				`space == "spaces/team"`,
				RenderOptions{Dialect: dialect},
			)
			require.NoError(t, err, schema.Name, dialect)
			require.Contains(t, assigned.SQL, "spaces/", schema.Name, dialect)
			require.Equal(t, []any{"spaces/team"}, assigned.Args, schema.Name, dialect)

			unassigned, err := engine.CompileToStatement(context.Background(), `space == null`, RenderOptions{Dialect: dialect})
			require.NoError(t, err, schema.Name, dialect)
			require.Contains(t, unassigned.SQL, "IS NULL", schema.Name, dialect)
			require.Empty(t, unassigned.Args, schema.Name, dialect)
		}

		for _, dialect := range []DialectName{DialectSQLite, DialectMySQL, DialectPostgres} {
			assigned, err := engine.CompileToStatement(context.Background(), `space != null`, RenderOptions{Dialect: dialect})
			require.NoError(t, err, schema.Name, dialect)
			require.Contains(t, assigned.SQL, "IS NOT NULL", schema.Name, dialect)
			require.Empty(t, assigned.Args, schema.Name, dialect)
		}

		_, err = engine.Compile(context.Background(), `space != "spaces/team"`)
		require.ErrorContains(t, err, `operator != not allowed for field "space"`, "NULL != value would silently drop unassigned memos")
	}
}

func TestCompileContainsEscapesLikeWildcards(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// Short needles stay on the LIKE path so trigram FTS is not required.
	stmt, err := engine.CompileToStatement(context.Background(), `content.contains("%_")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	// The % and _ in the value must be escaped so they are matched literally,
	// and SQLite needs an explicit ESCAPE clause.
	require.Contains(t, stmt.SQL, `ESCAPE '\'`)
	require.Equal(t, []any{`%\%\_%`}, stmt.Args)
}

func TestCompileContainsUsesSQLiteFTSForLongNeedles(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	stmt, err := engine.CompileToStatement(context.Background(), `content.contains("meeting notes")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "memo_fts")
	require.Contains(t, stmt.SQL, "MATCH")
	require.Equal(t, []any{`"meeting notes"`}, stmt.Args)

	// Quoted phrase keeps FTS operators literal.
	stmt, err = engine.CompileToStatement(context.Background(), `content.contains("NEAR(a b)")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Equal(t, []any{`"NEAR(a b)"`}, stmt.Args)

	// Postgres keeps portable ILIKE (pg_trgm only accelerates the existing path).
	pg, err := engine.CompileToStatement(context.Background(), `content.contains("meeting notes")`, RenderOptions{Dialect: DialectPostgres})
	require.NoError(t, err)
	require.Contains(t, pg.SQL, "ILIKE")
	require.NotContains(t, pg.SQL, "memo_fts")
	require.NotContains(t, pg.SQL, "AGAINST")
}

func TestCompileContainsUsesMySQLNgramForLongNeedles(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// Long enough for ngram tokenization (>= 2 runes): MATCH ... AGAINST phrase.
	stmt, err := engine.CompileToStatement(context.Background(), `content.contains("meeting notes")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "MATCH(`memo`.`content`) AGAINST(")
	require.Contains(t, stmt.SQL, "IN BOOLEAN MODE")
	require.NotContains(t, stmt.SQL, "LIKE")
	require.Equal(t, []any{`"meeting notes"`}, stmt.Args)

	// Two-rune needle is the ngram minimum and still uses FULLTEXT.
	stmt, err = engine.CompileToStatement(context.Background(), `content.contains("你好")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "AGAINST(")
	require.Equal(t, []any{`"你好"`}, stmt.Args)

	// Internal double quotes are stripped so the boolean-mode phrase stays intact.
	stmt, err = engine.CompileToStatement(context.Background(), `content.contains("foo\"bar")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Equal(t, []any{`"foobar"`}, stmt.Args)

	// Boolean operators inside the needle stay literal (wrapped in the phrase).
	stmt, err = engine.CompileToStatement(context.Background(), `content.contains("+meet -notes")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Equal(t, []any{`"+meet -notes"`}, stmt.Args)

	// Single-rune needles stay on LIKE: ngram_token_size defaults to 2.
	stmt, err = engine.CompileToStatement(context.Background(), `content.contains("a")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "LIKE")
	require.NotContains(t, stmt.SQL, "AGAINST")
	require.Equal(t, []any{`%a%`}, stmt.Args)

	// startsWith/endsWith cannot be expressed as ngram phrases; keep LIKE.
	stmt, err = engine.CompileToStatement(context.Background(), `content.startsWith("meeting")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "LIKE")
	require.NotContains(t, stmt.SQL, "AGAINST")
	require.Equal(t, []any{`meeting%`}, stmt.Args)
}

func TestRenderTagMembershipIsExactPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	const tag = `work_%"quoted"`
	cases := []struct {
		dialect   DialectName
		fragments []string
	}{
		{DialectSQLite, []string{"json_each(", "COLLATE BINARY"}},
		{DialectMySQL, []string{"JSON_TABLE(", "CAST(tag_item.value AS BINARY)"}},
		{DialectPostgres, []string{"jsonb_array_elements_text(", `(tag_item.value COLLATE "C")`}},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `tag in ["work_%\"quoted\""]`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		for _, fragment := range tc.fragments {
			require.Contains(t, stmt.SQL, fragment, tc.dialect)
		}
		require.NotContains(t, stmt.SQL, " LIKE ", tc.dialect)
		require.Equal(t, []any{tag}, stmt.Args, tc.dialect)
	}
}

func TestRenderTagExistsEqualityIsExactPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	const tag = `work_%"quoted"`
	cases := []struct {
		dialect   DialectName
		fragments []string
	}{
		{DialectSQLite, []string{"json_each(", "COLLATE BINARY"}},
		{DialectMySQL, []string{"JSON_TABLE(", "CAST(tag_item.value AS BINARY)"}},
		{DialectPostgres, []string{"jsonb_array_elements_text(", `(tag_item.value COLLATE "C")`}},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `tags.exists(t, t == "work_%\"quoted\"")`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		for _, fragment := range tc.fragments {
			require.Contains(t, stmt.SQL, fragment, tc.dialect)
		}
		require.NotContains(t, stmt.SQL, " LIKE ", tc.dialect)
		require.Equal(t, []any{tag}, stmt.Args, tc.dialect)
	}
}

func TestRenderTagComprehensionEqualityIsExactAndUnboundedOnMySQL(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	for _, expression := range []string{`tags.all(t, t == "Work")`, `tags.exists_one(t, t == "Work")`} {
		stmt, err := engine.CompileToStatement(context.Background(), expression, RenderOptions{Dialect: DialectMySQL})
		require.NoError(t, err)
		require.Contains(t, stmt.SQL, "value LONGTEXT PATH '$'")
		require.Contains(t, stmt.SQL, "CAST(tag_item.value AS BINARY) = CAST(? AS BINARY)")
		require.NotContains(t, stmt.SQL, "VARCHAR(512)")
		require.Equal(t, []any{"Work"}, stmt.Args)
	}
}

func TestRenderTagComprehensionEqualityUsesBinaryPostgresCollation(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	for _, expression := range []string{`tags.all(t, t == "Work")`, `tags.exists_one(t, t == "Work")`} {
		stmt, err := engine.CompileToStatement(context.Background(), expression, RenderOptions{Dialect: DialectPostgres})
		require.NoError(t, err)
		require.Contains(t, stmt.SQL, `(tag_item.value COLLATE "C") = ($1::text COLLATE "C")`)
		require.Equal(t, []any{"Work"}, stmt.Args)
	}
}

func TestRenderTagStringPredicatesAreExactPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	predicates := []struct {
		name        string
		expression  string
		sqliteSQL   string
		sqliteArgs  []any
		likePattern string
		usesLike    bool
	}{
		{name: "equals", expression: `t == "Work_%!"`, sqliteSQL: "COLLATE BINARY", sqliteArgs: []any{"Work_%!"}},
		{name: "startsWith", expression: `t.startsWith("Work_%!")`, sqliteSQL: "instr(tag_item.value, ?) = 1", sqliteArgs: []any{"Work_%!"}, likePattern: "Work!_!%!!%", usesLike: true},
		{name: "endsWith", expression: `t.endsWith("Work_%!")`, sqliteSQL: "substr(tag_item.value, -length(?))", sqliteArgs: []any{"Work_%!", "Work_%!"}, likePattern: "%Work!_!%!!", usesLike: true},
		{name: "contains", expression: `t.contains("Work_%!")`, sqliteSQL: "instr(tag_item.value, ?) > 0", sqliteArgs: []any{"Work_%!"}, likePattern: "%Work!_!%!!%", usesLike: true},
	}

	// MySQL cannot use EXISTS here: its semi-join rewrite drops JSON_TABLE's lateral
	// dependency on the outer row, so it counts rows instead. See
	// TestTagComprehensionAvoidsMySQLExistsSemiJoin.
	for _, comprehension := range []struct {
		kind        string
		sqlFragment string
		mysqlSQL    string
	}{
		{kind: "exists", sqlFragment: "EXISTS (SELECT 1", mysqlSQL: "SELECT COUNT(*)"},
		{kind: "all", sqlFragment: "NOT EXISTS (SELECT 1", mysqlSQL: "SELECT COUNT(*)"},
		{kind: "exists_one", sqlFragment: "SELECT COUNT(*)", mysqlSQL: "SELECT COUNT(*)"},
	} {
		for _, predicate := range predicates {
			expression := fmt.Sprintf("tags.%s(t, %s)", comprehension.kind, predicate.expression)
			t.Run(comprehension.kind+"/"+predicate.name, func(t *testing.T) {
				t.Parallel()

				sqliteStmt, err := engine.CompileToStatement(context.Background(), expression, RenderOptions{Dialect: DialectSQLite})
				require.NoError(t, err)
				require.Contains(t, sqliteStmt.SQL, "json_each(")
				require.Contains(t, sqliteStmt.SQL, comprehension.sqlFragment)
				require.Contains(t, sqliteStmt.SQL, predicate.sqliteSQL)
				require.NotContains(t, sqliteStmt.SQL, "memos_unicode_lower")
				require.Equal(t, predicate.sqliteArgs, sqliteStmt.Args)

				mysqlStmt, err := engine.CompileToStatement(context.Background(), expression, RenderOptions{Dialect: DialectMySQL})
				require.NoError(t, err)
				require.Contains(t, mysqlStmt.SQL, "JSON_TABLE(")
				require.Contains(t, mysqlStmt.SQL, comprehension.mysqlSQL)
				require.NotContains(t, mysqlStmt.SQL, "EXISTS (SELECT 1")
				require.Contains(t, mysqlStmt.SQL, "CAST(tag_item.value AS BINARY)")

				postgresStmt, err := engine.CompileToStatement(context.Background(), expression, RenderOptions{Dialect: DialectPostgres})
				require.NoError(t, err)
				require.Contains(t, postgresStmt.SQL, "jsonb_array_elements_text(")
				require.Contains(t, postgresStmt.SQL, comprehension.sqlFragment)
				require.Contains(t, postgresStmt.SQL, `(tag_item.value COLLATE "C")`)

				if predicate.usesLike {
					require.Contains(t, mysqlStmt.SQL, " LIKE ")
					require.Contains(t, mysqlStmt.SQL, "ESCAPE '!'")
					require.Contains(t, postgresStmt.SQL, " LIKE ")
					require.Contains(t, postgresStmt.SQL, "ESCAPE '!'")
					require.Equal(t, []any{predicate.likePattern}, mysqlStmt.Args)
					require.Equal(t, []any{predicate.likePattern}, postgresStmt.Args)
				} else {
					require.NotContains(t, mysqlStmt.SQL, " LIKE ")
					require.NotContains(t, postgresStmt.SQL, " LIKE ")
					require.Equal(t, []any{"Work_%!"}, mysqlStmt.Args)
					require.Equal(t, []any{"Work_%!"}, postgresStmt.Args)
				}
			})
		}
	}
}

func TestRenderEmptyTagListIsFalse(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	for _, dialect := range []DialectName{DialectSQLite, DialectMySQL, DialectPostgres} {
		stmt, err := engine.CompileToStatement(context.Background(), `tag in []`, RenderOptions{Dialect: dialect})
		require.NoError(t, err, dialect)
		require.Equal(t, "1 = 0", stmt.SQL, dialect)
		require.Empty(t, stmt.Args, dialect)
	}
}

func TestRenderTagStringPredicatesSQLiteBehavior(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	_, err = db.Exec(`CREATE TABLE memo (id INTEGER PRIMARY KEY, payload TEXT)`)
	require.NoError(t, err)
	for _, fixture := range []struct {
		id      int
		payload string
	}{
		{1, `{"tags":["Work_%done"]}`},
		{2, `{"tags":["work_%done"]}`},
		{3, `{"tags":["WorkX%done"]}`},
		{4, `{"tags":["Work_XXdone"]}`},
		{5, `{"tags":["Work_%done","other"]}`},
		{6, `{"tags":["Work_%done","Work_%done"]}`},
		{7, `{"tags":["preWork_%done"]}`},
		{8, `{"tags":["Work_%doneSuffix"]}`},
	} {
		_, err = db.Exec(`INSERT INTO memo (id, payload) VALUES (?, ?)`, fixture.id, fixture.payload)
		require.NoError(t, err)
	}

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	tests := []struct {
		name      string
		predicate string
		exists    []int
		all       []int
		existsOne []int
	}{
		{
			name:      "equality",
			predicate: `t == "Work_%done"`,
			exists:    []int{1, 5, 6},
			all:       []int{1, 6},
			existsOne: []int{1, 5},
		},
		{
			name:      "startsWith",
			predicate: `t.startsWith("Work_%done")`,
			exists:    []int{1, 5, 6, 8},
			all:       []int{1, 6, 8},
			existsOne: []int{1, 5, 8},
		},
		{
			name:      "endsWith",
			predicate: `t.endsWith("Work_%done")`,
			exists:    []int{1, 5, 6, 7},
			all:       []int{1, 6, 7},
			existsOne: []int{1, 5, 7},
		},
		{
			name:      "contains",
			predicate: `t.contains("Work_%done")`,
			exists:    []int{1, 5, 6, 7, 8},
			all:       []int{1, 6, 7, 8},
			existsOne: []int{1, 5, 7, 8},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			for _, comprehension := range []struct {
				name string
				want []int
			}{
				{name: "exists", want: tc.exists},
				{name: "all", want: tc.all},
				{name: "exists_one", want: tc.existsOne},
			} {
				t.Run(comprehension.name, func(t *testing.T) {
					stmt, err := engine.CompileToStatement(
						context.Background(),
						fmt.Sprintf("tags.%s(t, %s)", comprehension.name, tc.predicate),
						RenderOptions{Dialect: DialectSQLite},
					)
					require.NoError(t, err)
					require.Equal(t, comprehension.want, selectMemoIDs(t, db, stmt))
				})
			}
		})
	}
}

func selectMemoIDs(t *testing.T, db *sql.DB, stmt Statement) []int {
	t.Helper()

	rows, err := db.Query(`SELECT id FROM memo WHERE `+stmt.SQL+` ORDER BY id`, stmt.Args...)
	require.NoError(t, err)
	defer rows.Close()

	var ids []int
	for rows.Next() {
		var id int
		require.NoError(t, rows.Scan(&id))
		ids = append(ids, id)
	}
	require.NoError(t, rows.Err())
	return ids
}

// =============================================================================
// Cross-dialect rendering tests (no DB required; complements the SQLite-only
// behavioral tests in store/test by asserting MySQL/Postgres SQL generation).
// =============================================================================

func TestRenderStartsWithPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		dialect   DialectName
		fragments []string
	}{
		{DialectSQLite, []string{"memos_unicode_lower(", "`memo`.`content`", `ESCAPE '\'`}},
		{DialectPostgres, []string{"memo.content ILIKE $1"}},
		{DialectMySQL, []string{"`memo`.`content` LIKE ?"}},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `content.startsWith("TODO")`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		for _, frag := range tc.fragments {
			require.Contains(t, stmt.SQL, frag, "dialect %s", tc.dialect)
		}
		require.Equal(t, []any{"TODO%"}, stmt.Args, "dialect %s", tc.dialect)
	}
}

func TestRenderEndsWithPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	for _, dialect := range []DialectName{DialectSQLite, DialectPostgres, DialectMySQL} {
		stmt, err := engine.CompileToStatement(context.Background(), `content.endsWith(".md")`, RenderOptions{Dialect: dialect})
		require.NoError(t, err, dialect)
		require.Equal(t, []any{"%.md"}, stmt.Args, "dialect %s", dialect)
	}
}

func TestRenderMatchesPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		dialect  DialectName
		fragment string
	}{
		{DialectSQLite, "`memo`.`content` REGEXP ?"},
		{DialectMySQL, "`memo`.`content` REGEXP ?"},
		{DialectPostgres, "memo.content ~ $1"},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `content.matches("v[0-9]+")`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		require.Contains(t, stmt.SQL, tc.fragment, "dialect %s", tc.dialect)
		require.Equal(t, []any{"v[0-9]+"}, stmt.Args, "dialect %s", tc.dialect)
	}
}

func TestRenderTagsAllPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		dialect   DialectName
		fragments []string
		args      []any
	}{
		{DialectSQLite, []string{"NOT EXISTS", "json_each(", "json_array_length(", "instr(tag_item.value, ?) = 1"}, []any{"work/"}},
		{DialectPostgres, []string{"NOT EXISTS", "jsonb_array_elements_text(", "jsonb_array_length(", `(tag_item.value COLLATE "C") LIKE`}, []any{"work/%"}},
		// MySQL counts non-matching rows instead of using NOT EXISTS; see
		// TestTagComprehensionAvoidsMySQLExistsSemiJoin.
		{DialectMySQL, []string{") = 0", "JSON_TABLE(", "JSON_LENGTH(", "CAST(tag_item.value AS BINARY) LIKE"}, []any{"work/%"}},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `tags.all(t, t.startsWith("work/"))`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		for _, frag := range tc.fragments {
			require.Contains(t, stmt.SQL, frag, "dialect %s", tc.dialect)
		}
		require.Equal(t, tc.args, stmt.Args, "dialect %s", tc.dialect)
	}
}

func TestRenderTextMatchEscaping(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// Short needle: both % and _ must be escaped so they match literally.
	stmt, err := engine.CompileToStatement(context.Background(), `content.contains("a%")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, `ESCAPE '\'`)
	require.Equal(t, []any{`%a\%%`}, stmt.Args)

	// Long needle with wildcards is a literal FTS phrase (no LIKE metacharacters).
	stmt, err = engine.CompileToStatement(context.Background(), `content.contains("a%b_c")`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Equal(t, []any{`"a%b_c"`}, stmt.Args)
}

func TestRenderAllRejectsUnsupportedPredicate(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// size() is not a valid per-element predicate inside all().
	_, err = engine.CompileToStatement(context.Background(), `tags.all(t, size(t) > 2)`, RenderOptions{Dialect: DialectSQLite})
	require.Error(t, err)
}

// TestTagComprehensionAvoidsMySQLExistsSemiJoin pins the reason MySQL renders tag
// comprehensions as row counts rather than EXISTS.
//
// MySQL rewrites `EXISTS (SELECT ... FROM JSON_TABLE(<outer column>, ...))` into a
// semi-join, and that rewrite drops JSON_TABLE's lateral dependency on the outer row:
// the subquery evaluates as empty for every row, so the predicate is silently always
// false and every tag filter returns nothing. It fails with no SQL error, which is why
// this is guarded here rather than left to the container suite. `NOT EXISTS` happens to
// take the anti-join path and works, but relying on that asymmetry is not worth it, so
// both directions use counts.
func TestTagComprehensionAvoidsMySQLExistsSemiJoin(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	for _, expression := range []string{
		`tags.exists(t, t == "work")`,
		`tags.exists(t, t.startsWith("work/"))`,
		`tags.all(t, t == "work")`,
		`tags.all(t, t.contains("work"))`,
		`tags.exists_one(t, t == "work")`,
	} {
		stmt, err := engine.CompileToStatement(context.Background(), expression, RenderOptions{Dialect: DialectMySQL})
		require.NoError(t, err, expression)
		require.NotContains(t, stmt.SQL, "EXISTS", "%s must not use EXISTS on MySQL", expression)
		require.Contains(t, stmt.SQL, "SELECT COUNT(*)", "%s should count JSON_TABLE rows on MySQL", expression)
		require.Contains(t, stmt.SQL, "JSON_TABLE(", expression)
	}

	// The other dialects correlate EXISTS correctly and keep using it.
	for _, dialect := range []DialectName{DialectSQLite, DialectPostgres} {
		stmt, err := engine.CompileToStatement(context.Background(), `tags.exists(t, t == "work")`, RenderOptions{Dialect: dialect})
		require.NoError(t, err, dialect)
		require.Contains(t, stmt.SQL, "EXISTS (SELECT 1", "dialect %s", dialect)
	}
}

func TestRenderHasLocationPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		dialect DialectName
		sql     string
	}{
		{DialectSQLite, "JSON_EXTRACT(`memo`.`payload`, '$.location') IS NOT NULL"},
		{DialectMySQL, "COALESCE(JSON_TYPE(JSON_EXTRACT(`memo`.`payload`, '$.location')), 'NULL') != 'NULL'"},
		{DialectPostgres, "memo.payload->>'location' IS NOT NULL"},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `has_location`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		require.Equal(t, tc.sql, stmt.SQL, tc.dialect)
		require.Empty(t, stmt.Args, tc.dialect)
	}
}

func TestRenderHasLocationNegationAndComparisons(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	const exists = "JSON_EXTRACT(`memo`.`payload`, '$.location') IS NOT NULL"
	cases := []struct {
		expr string
		sql  string
	}{
		{`has_location`, exists},
		{`!has_location`, "NOT (" + exists + ")"},
		{`has_location == true`, exists},
		{`has_location == false`, "NOT (" + exists + ")"},
		{`has_location != true`, "NOT (" + exists + ")"},
		{`has_location != false`, exists},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), tc.expr, RenderOptions{Dialect: DialectSQLite})
		require.NoError(t, err, tc.expr)
		require.Equal(t, tc.sql, stmt.SQL, tc.expr)
		require.Empty(t, stmt.Args, tc.expr)
	}
}

func TestCompileRejectsOrderingOnHasLocation(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// Only ==/!= are meaningful for a presence flag.
	_, err = engine.Compile(context.Background(), `has_location < true`)
	require.Error(t, err)
}

// TestHasLocationSQLiteBehavior pins the presence semantics against a real
// database: a missing key, an explicit JSON null, and a NULL payload all count
// as absent, while any location object — even an empty one — counts as present.
func TestHasLocationSQLiteBehavior(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	_, err = db.Exec(`CREATE TABLE memo (id INTEGER PRIMARY KEY, payload TEXT)`)
	require.NoError(t, err)
	for _, fixture := range []struct {
		id      int
		payload any
	}{
		{1, `{}`},
		{2, `{"location":{"placeholder":"Tokyo","latitude":35.6,"longitude":139.7}}`},
		{3, `{"location":{}}`},
		{4, `{"location":null}`},
		{5, nil},
	} {
		_, err = db.Exec(`INSERT INTO memo (id, payload) VALUES (?, ?)`, fixture.id, fixture.payload)
		require.NoError(t, err)
	}

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		expr string
		want []int
	}{
		{`has_location`, []int{2, 3}},
		{`!has_location`, []int{1, 4, 5}},
		{`has_location == false`, []int{1, 4, 5}},
		{`has_location != false`, []int{2, 3}},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), tc.expr, RenderOptions{Dialect: DialectSQLite})
		require.NoError(t, err, tc.expr)
		require.Equal(t, tc.want, selectMemoIDs(t, db, stmt), tc.expr)
	}
}

// =============================================================================
// Related-text fields: attachment_filename and comment
// =============================================================================

func TestRenderAttachmentFilenameContainsPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		dialect   DialectName
		fragments []string
		not       []string
		args      []any
	}{
		{
			DialectSQLite,
			[]string{"EXISTS (SELECT 1 FROM `attachment`", "`attachment`.`memo_id` = `memo`.`id`", "memos_unicode_lower(`attachment`.`filename`) LIKE"},
			nil,
			[]any{`%report\%%`},
		},
		{
			DialectMySQL,
			[]string{"EXISTS (SELECT 1 FROM `attachment`", "`attachment`.`memo_id` = `memo`.`id`", "`attachment`.`filename` LIKE"},
			[]string{"AGAINST"},
			[]any{`%report\%%`},
		},
		{
			DialectPostgres,
			[]string{"EXISTS (SELECT 1 FROM attachment", "attachment.memo_id = memo.id", "attachment.filename ILIKE"},
			nil,
			[]any{`%report\%%`},
		},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `attachment_filename.contains("report%")`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		for _, frag := range tc.fragments {
			require.Contains(t, stmt.SQL, frag, "dialect %s", tc.dialect)
		}
		for _, frag := range tc.not {
			require.NotContains(t, stmt.SQL, frag, "dialect %s", tc.dialect)
		}
		require.Equal(t, tc.args, stmt.Args, "dialect %s", tc.dialect)
	}
}

func TestRenderCommentContainsPerDialect(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		dialect   DialectName
		fragments []string
		args      []any
	}{
		{
			DialectSQLite,
			[]string{
				"EXISTS (SELECT 1 FROM `memo` AS `comment_memo`",
				"JOIN `memo_relation` AS `comment_rel`",
				"`comment_rel`.`related_memo_id` = `comment_memo`.`id`",
				"`comment_rel`.`type` = 'COMMENT'",
				"`comment_rel`.`memo_id` = `memo`.`id`",
				"memos_unicode_lower(`comment_memo`.`content`) LIKE",
			},
			[]any{`%ship it%`},
		},
		{
			DialectMySQL,
			[]string{
				"EXISTS (SELECT 1 FROM `memo` AS `comment_memo`",
				"JOIN `memo_relation` AS `comment_rel`",
				"`comment_rel`.`type` = 'COMMENT'",
				"`comment_memo`.`content` LIKE",
			},
			[]any{`%ship it%`},
		},
		{
			DialectPostgres,
			[]string{
				"EXISTS (SELECT 1 FROM memo AS comment_memo",
				"JOIN memo_relation AS comment_rel",
				"comment_rel.type = 'COMMENT'",
				"comment_memo.content ILIKE",
			},
			[]any{`%ship it%`},
		},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), `comment.contains("ship it")`, RenderOptions{Dialect: tc.dialect})
		require.NoError(t, err, tc.dialect)
		for _, frag := range tc.fragments {
			require.Contains(t, stmt.SQL, frag, "dialect %s: %s", tc.dialect, stmt.SQL)
		}
		require.Equal(t, tc.args, stmt.Args, "dialect %s", tc.dialect)
	}
}

func TestRelatedTextFieldsRejectUnsupportedOperators(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// Comparison operators are blocked at parse time (empty AllowedComparisonOps).
	_, err = engine.CompileToStatement(context.Background(), `attachment_filename == "a.pdf"`, RenderOptions{Dialect: DialectSQLite})
	require.ErrorContains(t, err, "operator = not allowed")

	_, err = engine.CompileToStatement(context.Background(), `comment == "hi"`, RenderOptions{Dialect: DialectSQLite})
	require.ErrorContains(t, err, "operator = not allowed")

	// matches() has no outer-query column for REGEXP.
	_, err = engine.CompileToStatement(context.Background(), `attachment_filename.matches(".*")`, RenderOptions{Dialect: DialectSQLite})
	require.ErrorContains(t, err, "does not support matches()")

	_, err = engine.CompileToStatement(context.Background(), `comment.matches(".*")`, RenderOptions{Dialect: DialectSQLite})
	require.ErrorContains(t, err, "does not support matches()")

	// size() needs a length expression on a real column.
	_, err = engine.CompileToStatement(context.Background(), `size(attachment_filename) > 0`, RenderOptions{Dialect: DialectSQLite})
	require.Error(t, err)
}

func TestRelatedTextStartsWithAndEndsWith(t *testing.T) {
	t.Parallel()

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	// startsWith keeps a trailing-wildcard pattern inside the EXISTS.
	stmt, err := engine.CompileToStatement(context.Background(), `attachment_filename.startsWith("IMG_")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "EXISTS (SELECT 1 FROM `attachment`")
	require.Equal(t, []any{`IMG\_%`}, stmt.Args)

	// endsWith uses a leading wildcard. `.` is not a LIKE metacharacter.
	stmt, err = engine.CompileToStatement(context.Background(), `attachment_filename.endsWith(".pdf")`, RenderOptions{Dialect: DialectMySQL})
	require.NoError(t, err)
	require.Equal(t, []any{`%.pdf`}, stmt.Args)
}

// TestRelatedTextSQLiteBehavior exercises the EXISTS SQL against a real SQLite
// database. memos_unicode_lower is registered locally so foldedLike works
// without pulling in store/db/sqlite.
func TestRelatedTextSQLiteBehavior(t *testing.T) {
	registerTestUnicodeLower(t)
	db, err := sql.Open("sqlite", ":memory:")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	_, err = db.Exec(`CREATE TABLE memo (id INTEGER PRIMARY KEY, content TEXT)`)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE attachment (id INTEGER PRIMARY KEY, memo_id INTEGER, filename TEXT)`)
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TABLE memo_relation (memo_id INTEGER, related_memo_id INTEGER, type TEXT)`)
	require.NoError(t, err)

	_, err = db.Exec(`INSERT INTO memo (id, content) VALUES (1, 'parent'), (2, 'other'), (3, 'parent'), (4, 'parent')`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO memo (id, content) VALUES (10, 'Looks good, ship it'), (11, 'needs work')`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO attachment (memo_id, filename) VALUES (1, 'Quarterly-Report.pdf'), (3, 'photo.png')`)
	require.NoError(t, err)
	// memo 1 has a ship-it comment; memo 3's comment does not match.
	_, err = db.Exec(`INSERT INTO memo_relation (memo_id, related_memo_id, type) VALUES (1, 10, 'COMMENT'), (3, 11, 'COMMENT')`)
	require.NoError(t, err)

	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)

	cases := []struct {
		expr string
		want []int
	}{
		{`attachment_filename.contains("report")`, []int{1}},
		{`attachment_filename.contains("Report")`, []int{1}},
		{`attachment_filename.endsWith(".png")`, []int{3}},
		{`comment.contains("ship it")`, []int{1}},
		{`comment.contains("needs")`, []int{3}},
		{`attachment_filename.contains("report") && comment.contains("ship it")`, []int{1}},
		{`attachment_filename.contains("nomatch")`, nil},
	}
	for _, tc := range cases {
		stmt, err := engine.CompileToStatement(context.Background(), tc.expr, RenderOptions{Dialect: DialectSQLite})
		require.NoError(t, err, tc.expr)
		require.Equal(t, tc.want, selectMemoIDs(t, db, stmt), tc.expr)
	}
}
