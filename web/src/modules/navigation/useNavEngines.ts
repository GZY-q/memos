import { useCallback, useMemo, useState } from "react";
import { useNavStrings } from "./i18n";
import {
  createCustomEngine,
  DEFAULT_SEARCH_ENGINE,
  type EngineDraftError,
  getSearchEngine,
  listSearchEngines,
  MAX_CUSTOM_ENGINES,
  readCustomEngines,
  readPreferredEngine,
  type SearchEngine,
  type SearchEngineId,
  validateEngineDraft,
  writeCustomEngines,
  writePreferredEngine,
} from "./searchEngines";

const engineErrorMessage = (error: EngineDraftError, t: ReturnType<typeof useNavStrings>): string =>
  error === "labelRequired"
    ? t.engineLabelRequired
    : error === "urlInvalid"
      ? t.engineTemplateInvalid
      : error === "missingQueryPlaceholder"
        ? t.engineTemplateMissingQuery
        : t.engineTooMany(MAX_CUSTOM_ENGINES);

/** Built-in + custom engine list, preferred selection, and add/remove. */
export function useNavEngines() {
  const t = useNavStrings();
  const [customEngines, setCustomEnginesState] = useState<SearchEngine[]>(() => readCustomEngines());
  const [engineId, setEngineIdState] = useState<SearchEngineId>(() => {
    const saved = readPreferredEngine();
    return listSearchEngines(readCustomEngines()).some((engine) => engine.id === saved) ? saved : DEFAULT_SEARCH_ENGINE;
  });

  const engines = useMemo(() => listSearchEngines(customEngines), [customEngines]);

  const setEngineId = useCallback((id: SearchEngineId) => {
    setEngineIdState(id);
    writePreferredEngine(id);
  }, []);

  const setCustomEngines = useCallback((next: SearchEngine[]) => {
    setCustomEnginesState(next);
    writeCustomEngines(next);
  }, []);

  const handleAddEngine = useCallback(
    (draft: { label: string; urlTemplate: string }): string | null => {
      const problem = validateEngineDraft(draft, customEngines.length);
      if (problem) return engineErrorMessage(problem, t);
      const engine = createCustomEngine(draft, engines);
      setCustomEngines([...customEngines, engine]);
      setEngineId(engine.id);
      return null;
    },
    [customEngines, engines, setCustomEngines, setEngineId, t],
  );

  const handleRemoveEngine = useCallback(
    (id: SearchEngineId) => {
      const next = customEngines.filter((engine) => engine.id !== id);
      setCustomEngines(next);
      if (engineId === id) setEngineId(DEFAULT_SEARCH_ENGINE);
    },
    [customEngines, engineId, setCustomEngines, setEngineId],
  );

  const currentEngine = useMemo(() => getSearchEngine(engineId, customEngines), [engineId, customEngines]);

  return {
    engines,
    engineId,
    customEngines,
    currentEngine,
    setEngineId,
    handleAddEngine,
    handleRemoveEngine,
  };
}
