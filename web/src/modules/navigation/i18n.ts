/**
 * Module-local zh/en strings.
 *
 * Deliberately not added to `src/locales/*.json`: those files are the main
 * conflict surface on every upstream upgrade, and the navigation module owns
 * every string it renders. Only the active language is read from i18next.
 */

import { useTranslation } from "react-i18next";

export interface NavStrings {
  sidebarLabel: string;
  pageTitle: string;
  pageSubtitle: string;
  loading: string;
  emptyTitle: string;
  emptyBody: string;
  degradedTitle: string;
  degradedBody: string;
  seededNote: string;
  retry: string;
  saving: string;
  saveFailed: string;
  collapse: string;
  expand: string;
  collapseAll: string;
  expandAll: string;
  openAllLinks: string;
  openAllLinksConfirm: (count: number) => string;
  openAllLinksTitle: string;
  openAllLinksOpened: (opened: number) => string;
  openAllLinksBlocked: (blocked: number) => string;
  emptyGroup: string;
  searchPlaceholder: string;
  searchEmptyTitle: string;
  searchEmptyBody: string;
  clearSearch: string;
  /** Reserved for a settings/help surface — never rendered on toolbar buttons. */
  searchKeyboardHint: string;
  importBookmarks: string;
  importBookmarksHint: string;
  importEmpty: string;
  importFailed: string;
  importNoNew: string;
  importTooLarge: (size: number, limit: number) => string;
  importSuccess: (cards: number, groups: number, skipped: number) => string;
  clipboardAdd: string;
  clipboardEmpty: string;
  clipboardFailed: string;
  clipboardHistory: string;
  clipboardHistoryEmpty: string;
  clipboardHistoryHint: string;
  clipboardCopy: string;
  clipboardUse: string;
  clipboardRemove: string;
  clipboardCopied: string;
  clipboardRich: string;
  addCard: string;
  editCard: string;
  deleteCard: string;
  addGroup: string;
  renameGroup: string;
  deleteGroup: string;
  fieldTitle: string;
  fieldUrl: string;
  fieldNote: string;
  fieldGroup: string;
  fieldName: string;
  save: string;
  cancel: string;
  delete: string;
  confirm: string;
  titleRequired: string;
  urlInvalid: string;
  urlDuplicate: string;
  nameRequired: string;
  deleteCardConfirm: string;
  deleteGroupConfirm: string;
  editActions: string;
  engineTabsLabel: string;
  addSearchEngine: string;
  addSearchEngineHint: string;
  fieldEngineLabel: string;
  fieldEngineTemplate: string;
  engineLabelRequired: string;
  engineTemplateInvalid: string;
  engineTemplateMissingQuery: string;
  engineTooMany: (max: number) => string;
  removeSearchEngine: string;
  customEngines: string;
  customEnginesEmpty: string;
}

const STRINGS: Record<"zh" | "en", NavStrings> = {
  zh: {
    sidebarLabel: "导航",
    pageTitle: "导航",
    pageSubtitle: "把常用站点收成一张可以拖拽整理的卡片墙。",
    loading: "正在加载导航配置…",
    emptyTitle: "还没有导航卡片",
    emptyBody: "配置文件缺失，点「重试」重新加载；若仍失败，可删除归档里的配置备忘后再次打开本页。",
    degradedTitle: "离线缓存模式",
    degradedBody: "无法连接服务，当前展示本地缓存的配置，改动不会保存。",
    seededNote: "首次访问已写入默认配置（一条归档 + 私密备忘）。",
    retry: "重试",
    saving: "保存中…",
    saveFailed: "保存失败：处于离线模式，改动未保存。",
    collapse: "折叠",
    expand: "展开",
    collapseAll: "全部折叠",
    expandAll: "全部展开",
    openAllLinks: "打开该分组全部链接",
    openAllLinksTitle: "打开全部链接",
    openAllLinksConfirm: (count: number) => `将打开 ${count} 个标签页，确定继续？`,
    openAllLinksOpened: (opened: number) => `已打开 ${opened} 个标签页。`,
    openAllLinksBlocked: (blocked: number) => `有 ${blocked} 个标签页被浏览器拦截，请允许弹出窗口后重试。`,
    emptyGroup: "这个分组还没有卡片。",
    searchPlaceholder: "搜索卡片或网页…",
    searchEmptyTitle: "没有匹配的卡片",
    searchEmptyBody: "本地没有匹配卡片，可以直接网页搜索。",
    clearSearch: "清除搜索",
    searchKeyboardHint: "/ 聚焦 · Tab 切换引擎 · ↓↑ 移动卡片 · Enter 网页搜索 · Esc 清除",
    importBookmarks: "导入书签",
    importBookmarksHint: "支持 Chrome / Edge 导出的 HTML 书签文件",
    importEmpty: "没有读到有效书签，请确认是浏览器导出的 HTML 文件。",
    importFailed: "导入失败：文件无法解析。",
    importNoNew: "书签已全部存在，没有新卡片可导入。",
    importTooLarge: (size: number, limit: number) =>
      `导入后配置约 ${size} 字符，超过备忘内容上限 ${limit}。可在「实例设置 → 备忘相关」调大内容长度限制，或分批导入。`,
    importSuccess: (cards: number, groups: number, skipped: number) =>
      `导入完成：${cards} 张卡片${groups > 0 ? `，新建 ${groups} 个分组` : ""}${skipped > 0 ? `，跳过 ${skipped} 个重复` : ""}。`,
    clipboardAdd: "从剪贴板添加",
    clipboardEmpty: "剪贴板是空的",
    clipboardFailed: "无法读取剪贴板",
    clipboardHistory: "剪贴板",
    clipboardHistoryEmpty: "暂无记录。复制或粘贴到搜索框后会出现在这里。",
    clipboardHistoryHint: "24 小时后自动清理",
    clipboardCopy: "复制",
    clipboardUse: "使用",
    clipboardRemove: "移除",
    clipboardCopied: "已复制",
    clipboardRich: "图文",
    addCard: "添加卡片",
    editCard: "编辑卡片",
    deleteCard: "删除卡片",
    addGroup: "添加分组",
    renameGroup: "重命名分组",
    deleteGroup: "删除分组",
    fieldTitle: "标题",
    fieldUrl: "链接",
    fieldNote: "备注",
    fieldGroup: "分组",
    fieldName: "分组名称",
    save: "保存",
    cancel: "取消",
    delete: "删除",
    confirm: "确认",
    titleRequired: "请填写标题。",
    urlInvalid: "请输入有效的 http(s) 链接。",
    urlDuplicate: "该链接已存在。",
    nameRequired: "请填写分组名称。",
    deleteCardConfirm: "确定删除这张卡片？",
    deleteGroupConfirm: "确定删除该分组及其全部卡片？",
    editActions: "卡片操作",
    engineTabsLabel: "搜索引擎",
    addSearchEngine: "添加自定义引擎",
    addSearchEngineHint: "URL 模板需以 http(s):// 开头，并用 {q} 占位搜索词。",
    fieldEngineLabel: "名称",
    fieldEngineTemplate: "URL 模板",
    engineLabelRequired: "请填写名称。",
    engineTemplateInvalid: "请输入有效的 http(s) 链接。",
    engineTemplateMissingQuery: "URL 模板需要包含 {q} 占位符。",
    engineTooMany: (max: number) => `最多只能添加 ${max} 个自定义引擎。`,
    removeSearchEngine: "移除引擎",
    customEngines: "自定义引擎",
    customEnginesEmpty: "还没有自定义引擎。",
  },
  en: {
    sidebarLabel: "Navigation",
    pageTitle: "Navigation",
    pageSubtitle: "Your bookmarks as a card wall you can drag into shape.",
    loading: "Loading navigation config…",
    emptyTitle: "No cards yet",
    emptyBody: "The config memo is missing. Retry to reload; if it still fails, delete the config memo in Archive and reopen this page.",
    degradedTitle: "Offline cache",
    degradedBody: "The service is unreachable; showing the locally cached config. Edits are not saved.",
    seededNote: "First visit: wrote the default config (an archived, private memo).",
    retry: "Retry",
    saving: "Saving…",
    saveFailed: "Save failed: offline mode, changes were not saved.",
    collapse: "Collapse",
    expand: "Expand",
    collapseAll: "Collapse all",
    expandAll: "Expand all",
    openAllLinks: "Open all links in this group",
    openAllLinksTitle: "Open all links",
    openAllLinksConfirm: (count: number) => `Open ${count} tabs?`,
    openAllLinksOpened: (opened: number) => `Opened ${opened} tab${opened === 1 ? "" : "s"}.`,
    openAllLinksBlocked: (blocked: number) =>
      `${blocked} tab${blocked === 1 ? "" : "s"} blocked by the browser — allow popups and try again.`,
    emptyGroup: "This group has no cards yet.",
    searchPlaceholder: "Search cards or the web…",
    searchEmptyTitle: "No matching cards",
    searchEmptyBody: "No local cards match. You can search the web instead.",
    clearSearch: "Clear search",
    searchKeyboardHint: "/ focus · Tab switch engine · ↓↑ move · Enter web search · Esc clear",
    importBookmarks: "Import bookmarks",
    importBookmarksHint: "Chrome / Edge HTML bookmark export",
    importEmpty: "No valid bookmarks found. Use a browser-exported HTML file.",
    importFailed: "Import failed: could not parse the file.",
    importNoNew: "All bookmarks already exist — nothing new to import.",
    importTooLarge: (size: number, limit: number) =>
      `Imported config would be ~${size} characters, over the memo content limit of ${limit}. Raise “Content length limit” in Instance settings, or import in batches.`,
    importSuccess: (cards: number, groups: number, skipped: number) =>
      `Imported ${cards} card${cards === 1 ? "" : "s"}${groups > 0 ? `, ${groups} new group${groups === 1 ? "" : "s"}` : ""}${
        skipped > 0 ? `, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""
      }.`,
    clipboardAdd: "Add from clipboard",
    clipboardEmpty: "Clipboard is empty",
    clipboardFailed: "Could not read clipboard",
    clipboardHistory: "Clipboard",
    clipboardHistoryEmpty: "No items yet. Copied text or pastes into search appear here.",
    clipboardHistoryHint: "Auto-clears after 24 hours",
    clipboardCopy: "Copy",
    clipboardUse: "Use",
    clipboardRemove: "Remove",
    clipboardCopied: "Copied",
    clipboardRich: "Rich",
    addCard: "Add card",
    editCard: "Edit card",
    deleteCard: "Delete card",
    addGroup: "Add group",
    renameGroup: "Rename group",
    deleteGroup: "Delete group",
    fieldTitle: "Title",
    fieldUrl: "URL",
    fieldNote: "Note",
    fieldGroup: "Group",
    fieldName: "Group name",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    confirm: "Confirm",
    titleRequired: "Title is required.",
    urlInvalid: "Enter a valid http(s) URL.",
    urlDuplicate: "That URL already exists.",
    nameRequired: "Group name is required.",
    deleteCardConfirm: "Delete this card?",
    deleteGroupConfirm: "Delete this group and all of its cards?",
    editActions: "Card actions",
    engineTabsLabel: "Search engines",
    addSearchEngine: "Add custom engine",
    addSearchEngineHint: "URL template must start with http(s):// and include a {q} placeholder.",
    fieldEngineLabel: "Name",
    fieldEngineTemplate: "URL template",
    engineLabelRequired: "Name is required.",
    engineTemplateInvalid: "Enter a valid http(s) URL.",
    engineTemplateMissingQuery: "URL template must include the {q} placeholder.",
    engineTooMany: (max: number) => `You can add at most ${max} custom engines.`,
    removeSearchEngine: "Remove engine",
    customEngines: "Custom engines",
    customEnginesEmpty: "No custom engines yet.",
  },
};

const resolveLocale = (language?: string): "zh" | "en" => ((language ?? "").toLowerCase().startsWith("zh") ? "zh" : "en");

export const navStrings = (language?: string): NavStrings => STRINGS[resolveLocale(language)];

/** Re-renders on language change; safe to call from upstream components. */
export const useNavStrings = (): NavStrings => {
  const { i18n } = useTranslation();
  return navStrings(i18n.resolvedLanguage ?? i18n.language);
};
