import { create } from "@bufbuild/protobuf";
import { isEqual } from "lodash-es";
import { MoreVerticalIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useInstance } from "@/contexts/InstanceContext";
import {
  InstanceSetting_AIProviderConfig,
  InstanceSetting_AIProviderConfigSchema,
  InstanceSetting_AIProviderType,
  InstanceSetting_AISettingSchema,
  InstanceSetting_Key,
  InstanceSetting_TranscriptionConfig,
  InstanceSetting_TranscriptionConfigSchema,
  InstanceSetting_TTSConfig,
  InstanceSetting_TTSConfigSchema,
  InstanceSetting_WritingConfig,
  InstanceSetting_WritingConfigSchema,
  InstanceSettingSchema,
} from "@/types/proto/api/v1/instance_service_pb";
import { DEFAULT_EDGE_VOICE, EDGE_VOICES } from "@/utils/edge-voices";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import { SettingPanel } from "./SettingList";
import SettingSection from "./SettingSection";
import SettingTable from "./SettingTable";
import useInstanceSettingUpdater, { buildInstanceSettingName } from "./useInstanceSettingUpdater";

type LocalAIProvider = {
  id: string;
  title: string;
  type: InstanceSetting_AIProviderType;
  endpoint: string;
  apiKey: string;
  apiKeySet: boolean;
  apiKeyHint: string;
};

type LocalTranscription = {
  providerId: string;
  model: string;
  language: string;
  prompt: string;
};

type LocalTTS = {
  providerId: string;
  speaker: string;
  model: string;
};

type LocalWriting = {
  providerId: string;
  model: string;
  systemPrompt: string;
};

const providerTypeOptions = [
  InstanceSetting_AIProviderType.OPENAI,
  InstanceSetting_AIProviderType.GEMINI,
  InstanceSetting_AIProviderType.VOLCENGINE_ARK,
  InstanceSetting_AIProviderType.EDGE,
];

const writingProviderTypeOptions = [InstanceSetting_AIProviderType.OPENAI];

const isKeylessProviderType = (type: InstanceSetting_AIProviderType) => type === InstanceSetting_AIProviderType.EDGE;

const isWritingCapableProvider = (type: InstanceSetting_AIProviderType) => type === InstanceSetting_AIProviderType.OPENAI;

const byokNotes = ["setting.ai.byok-key-note", "setting.ai.byok-storage-note", "setting.ai.byok-model-note"] as const;

type ProviderDialogMode = "speech" | "writing";

const getProviderTypeLabel = (type: InstanceSetting_AIProviderType) => {
  return InstanceSetting_AIProviderType[type] ?? "UNKNOWN";
};

const toLocalProvider = (provider: InstanceSetting_AIProviderConfig): LocalAIProvider => ({
  id: provider.id,
  title: provider.title,
  type: provider.type,
  endpoint: provider.endpoint,
  apiKey: "",
  apiKeySet: provider.apiKeySet,
  apiKeyHint: provider.apiKeyHint,
});

const toLocalTranscription = (config: InstanceSetting_TranscriptionConfig | undefined): LocalTranscription => ({
  providerId: config?.providerId ?? "",
  model: config?.model ?? "",
  language: config?.language ?? "",
  prompt: config?.prompt ?? "",
});

const toLocalTTS = (config: InstanceSetting_TTSConfig | undefined): LocalTTS => ({
  providerId: config?.providerId ?? "",
  speaker: config?.speaker ?? "",
  model: config?.model ?? "",
});

const toLocalWriting = (config: InstanceSetting_WritingConfig | undefined): LocalWriting => ({
  providerId: config?.providerId ?? "",
  model: config?.model ?? "",
  systemPrompt: config?.systemPrompt ?? "",
});

const newProvider = (type: InstanceSetting_AIProviderType = InstanceSetting_AIProviderType.OPENAI): LocalAIProvider => ({
  id: uuidv4(),
  title: "",
  type,
  endpoint: "",
  apiKey: "",
  apiKeySet: false,
  apiKeyHint: "",
});

const toProviderConfig = (provider: LocalAIProvider) =>
  create(InstanceSetting_AIProviderConfigSchema, {
    id: provider.id,
    title: provider.title.trim(),
    type: provider.type,
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
  });

const toTranscriptionConfig = (transcription: LocalTranscription) =>
  create(InstanceSetting_TranscriptionConfigSchema, {
    providerId: transcription.providerId,
    model: transcription.model.trim(),
    language: transcription.language.trim(),
    prompt: transcription.prompt,
  });

const toTTSConfig = (tts: LocalTTS) =>
  create(InstanceSetting_TTSConfigSchema, {
    providerId: tts.providerId,
    speaker: tts.speaker.trim(),
    model: tts.model.trim(),
  });

const toWritingConfig = (writing: LocalWriting) =>
  create(InstanceSetting_WritingConfigSchema, {
    providerId: writing.providerId,
    model: writing.model.trim(),
    systemPrompt: writing.systemPrompt,
  });

const AISection = () => {
  const t = useTranslate();
  const saveInstanceSetting = useInstanceSettingUpdater();
  const { aiSetting: originalSetting } = useInstance();
  const [providers, setProviders] = useState<LocalAIProvider[]>(() => originalSetting.providers.map(toLocalProvider));
  const [transcription, setTranscription] = useState<LocalTranscription>(() => toLocalTranscription(originalSetting.transcription));
  const [tts, setTts] = useState<LocalTTS>(() => toLocalTTS(originalSetting.tts));
  const [writing, setWriting] = useState<LocalWriting>(() => toLocalWriting(originalSetting.writing));
  const [editingProvider, setEditingProvider] = useState<LocalAIProvider | undefined>();
  const [editingMode, setEditingMode] = useState<ProviderDialogMode>("speech");
  const [deleteTarget, setDeleteTarget] = useState<LocalAIProvider | undefined>();

  useEffect(() => {
    setProviders(originalSetting.providers.map(toLocalProvider));
  }, [originalSetting.providers]);

  // Only re-sync the transcription draft when the server-side content actually
  // changes — not on every originalSetting identity change. This prevents
  // provider-side saves (which keep transcription unchanged on the server) from
  // wiping an in-progress transcription draft.
  const lastSyncedTranscription = useRef<LocalTranscription>(toLocalTranscription(originalSetting.transcription));
  useEffect(() => {
    const next = toLocalTranscription(originalSetting.transcription);
    if (!isEqual(lastSyncedTranscription.current, next)) {
      setTranscription(next);
      lastSyncedTranscription.current = next;
    }
  }, [originalSetting.transcription]);

  const lastSyncedTTS = useRef<LocalTTS>(toLocalTTS(originalSetting.tts));
  useEffect(() => {
    const next = toLocalTTS(originalSetting.tts);
    if (!isEqual(lastSyncedTTS.current, next)) {
      setTts(next);
      lastSyncedTTS.current = next;
    }
  }, [originalSetting.tts]);

  const lastSyncedWriting = useRef<LocalWriting>(toLocalWriting(originalSetting.writing));
  useEffect(() => {
    const next = toLocalWriting(originalSetting.writing);
    if (!isEqual(lastSyncedWriting.current, next)) {
      setWriting(next);
      lastSyncedWriting.current = next;
    }
  }, [originalSetting.writing]);

  const originalTranscription = useMemo(() => toLocalTranscription(originalSetting.transcription), [originalSetting.transcription]);
  const transcriptionHasChanges = !isEqual(transcription, originalTranscription);

  const originalTTS = useMemo(() => toLocalTTS(originalSetting.tts), [originalSetting.tts]);
  const ttsHasChanges = !isEqual(tts, originalTTS);

  const originalWriting = useMemo(() => toLocalWriting(originalSetting.writing), [originalSetting.writing]);
  const writingHasChanges = !isEqual(writing, originalWriting);

  const transcriptionProviderRef = useMemo(
    () => providers.find((provider) => provider.id === transcription.providerId),
    [providers, transcription.providerId],
  );

  const ttsProviderRef = useMemo(() => providers.find((provider) => provider.id === tts.providerId), [providers, tts.providerId]);

  const writingProviderRef = useMemo(
    () => providers.find((provider) => provider.id === writing.providerId),
    [providers, writing.providerId],
  );

  // Writing assistant speaks OpenAI Chat Completions; only OPENAI-type
  // providers (including custom OpenAI-compatible endpoints) are eligible.
  const writingProviders = useMemo(() => providers.filter((provider) => isWritingCapableProvider(provider.type)), [providers]);

  // Speech integrations cover every provider type (Whisper STT, Gemini audio,
  // Volcengine Ark TTS, Edge read-aloud). They are listed separately from the
  // writing pool so the two capability surfaces stay easy to scan.
  const speechProviders = useMemo(() => providers, [providers]);

  // Persists the AI setting using a specific providers list and feature configs
  // value. Provider operations pass originalSetting values so in-progress
  // drafts are never accidentally committed.
  const persistAISetting = async (
    nextProviders: LocalAIProvider[],
    nextTranscription: InstanceSetting_TranscriptionConfig | undefined,
    nextTTS: InstanceSetting_TTSConfig | undefined,
    nextWriting: InstanceSetting_WritingConfig | undefined,
    errorContext: string,
  ) => {
    return saveInstanceSetting({
      key: InstanceSetting_Key.AI,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.AI),
        value: {
          case: "aiSetting",
          value: create(InstanceSetting_AISettingSchema, {
            providers: nextProviders.map(toProviderConfig),
            transcription: nextTranscription,
            tts: nextTTS,
            writing: nextWriting,
          }),
        },
      }),
      errorContext,
    });
  };

  const handleCreateSpeechProvider = () => {
    setEditingMode("speech");
    // Edge is the most common keyless speech integration; admins can switch type.
    setEditingProvider(newProvider(InstanceSetting_AIProviderType.EDGE));
  };

  const handleCreateWritingProvider = () => {
    setEditingMode("writing");
    setEditingProvider(newProvider(InstanceSetting_AIProviderType.OPENAI));
  };

  const handleEditProvider = (provider: LocalAIProvider, mode: ProviderDialogMode) => {
    setEditingMode(mode);
    setEditingProvider({ ...provider, apiKey: "" });
  };

  const handleSaveProvider = async (provider: LocalAIProvider) => {
    const title = provider.title.trim();
    const endpoint = provider.endpoint.trim();

    if (!title) {
      toast.error(t("setting.ai.provider-title-required"));
      return;
    }
    if (!isKeylessProviderType(provider.type) && !provider.apiKeySet && !provider.apiKey.trim()) {
      toast.error(t("setting.ai.api-key-required"));
      return;
    }

    const normalizedProvider = { ...provider, title, endpoint };
    const exists = providers.some((item) => item.id === normalizedProvider.id);
    const nextProviders = exists
      ? providers.map((item) => (item.id === normalizedProvider.id ? normalizedProvider : item))
      : [...providers, normalizedProvider];

    const ok = await persistAISetting(
      nextProviders,
      originalSetting.transcription,
      originalSetting.tts,
      originalSetting.writing,
      "Update AI provider",
    );
    if (!ok) return;
    setProviders(nextProviders);
    setEditingProvider(undefined);
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const nextProviders = providers.filter((provider) => provider.id !== target.id);

    // If the persisted feature configs reference the deleted provider, the
    // server would reject the save (provider_id must reference an existing
    // provider). Send a cleared config in that case.
    const persistedTranscription = originalSetting.transcription;
    const nextTranscription =
      persistedTranscription && persistedTranscription.providerId === target.id
        ? create(InstanceSetting_TranscriptionConfigSchema, {})
        : persistedTranscription;
    const persistedTTS = originalSetting.tts;
    const nextTTS = persistedTTS && persistedTTS.providerId === target.id ? create(InstanceSetting_TTSConfigSchema, {}) : persistedTTS;
    const persistedWriting = originalSetting.writing;
    const nextWriting =
      persistedWriting && persistedWriting.providerId === target.id ? create(InstanceSetting_WritingConfigSchema, {}) : persistedWriting;

    const ok = await persistAISetting(nextProviders, nextTranscription, nextTTS, nextWriting, "Delete AI provider");
    if (!ok) return;
    setProviders(nextProviders);
    if (transcription.providerId === target.id) {
      setTranscription((prev) => ({ ...prev, providerId: "" }));
    }
    if (tts.providerId === target.id) {
      setTts((prev) => ({ ...prev, providerId: "" }));
    }
    if (writing.providerId === target.id) {
      setWriting((prev) => ({ ...prev, providerId: "" }));
    }
    setDeleteTarget(undefined);
  };

  const handleSaveTranscription = async () => {
    if (transcription.providerId && !transcriptionProviderRef) {
      toast.error(t("setting.ai.transcription-empty-providers"));
      return;
    }
    await persistAISetting(
      providers,
      toTranscriptionConfig(transcription),
      originalSetting.tts,
      originalSetting.writing,
      "Update transcription",
    );
  };

  const handleSaveTTS = async () => {
    if (tts.providerId && !ttsProviderRef) {
      toast.error(t("setting.ai.tts-empty-providers"));
      return;
    }
    await persistAISetting(providers, originalSetting.transcription, toTTSConfig(tts), originalSetting.writing, "Update text-to-speech");
  };

  const handleSaveWriting = async () => {
    if (writing.providerId && !writingProviderRef) {
      toast.error(t("setting.ai.writing-empty-providers"));
      return;
    }
    await persistAISetting(
      providers,
      originalSetting.transcription,
      originalSetting.tts,
      toWritingConfig(writing),
      "Update writing assistant",
    );
  };

  const providerColumns = (mode: ProviderDialogMode) => [
    {
      key: "title",
      header: t("common.name"),
      render: (_: unknown, provider: LocalAIProvider) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">{provider.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{provider.id}</span>
        </div>
      ),
    },
    {
      key: "type",
      header: t("setting.ai.provider-type"),
      render: (_: unknown, provider: LocalAIProvider) => <span>{getProviderTypeLabel(provider.type)}</span>,
    },
    {
      key: "endpoint",
      header: t("setting.ai.endpoint"),
      render: (_: unknown, provider: LocalAIProvider) => (
        <span className="font-mono text-xs">{provider.endpoint || t("setting.ai.default-endpoint")}</span>
      ),
    },
    {
      key: "apiKeySet",
      header: t("setting.ai.api-key"),
      render: (_: unknown, provider: LocalAIProvider) => (
        <span className="font-mono text-xs">{provider.apiKeySet ? provider.apiKeyHint || t("setting.ai.configured") : "-"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (_: unknown, provider: LocalAIProvider) => (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            <MoreVerticalIcon className="w-4 h-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={2}>
            <DropdownMenuItem onClick={() => handleEditProvider(provider, mode)}>{t("common.edit")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDeleteTarget(provider)} className="text-destructive focus:text-destructive">
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <SettingSection title={t("setting.ai.label")} description={t("setting.ai.description")}>
      <SettingPanel className="bg-muted/30 px-4 py-3">
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              {t("setting.ai.byok-label")}
            </span>
            <h4 className="text-sm font-semibold text-foreground">{t("setting.ai.byok-title")}</h4>
          </div>
          <p className="text-sm text-muted-foreground">{t("setting.ai.byok-description")}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {byokNotes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 size-1 rounded-full bg-muted-foreground/60" aria-hidden />
                <span>{t(note)}</span>
              </li>
            ))}
          </ul>
        </div>
      </SettingPanel>

      {/* ── 语音服务 ─────────────────────────────────────────── */}
      <SettingGroup
        title={t("setting.ai.speech-title")}
        description={t("setting.ai.speech-description")}
        actions={
          <Button onClick={handleCreateSpeechProvider}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.add-speech-provider")}
          </Button>
        }
      >
        <SettingTable
          columns={providerColumns("speech")}
          data={speechProviders}
          emptyMessage={t("setting.ai.no-speech-providers")}
          getRowKey={(provider) => provider.id}
        />
      </SettingGroup>

      <SettingGroup
        title={t("setting.ai.transcription-title")}
        description={t("setting.ai.transcription-description")}
        showSeparator
        actions={
          <Button disabled={!transcriptionHasChanges} onClick={handleSaveTranscription}>
            {t("common.save")}
          </Button>
        }
      >
        <TranscriptionForm
          providers={speechProviders}
          transcription={transcription}
          onChange={setTranscription}
          referencedProvider={transcriptionProviderRef}
        />
      </SettingGroup>

      <SettingGroup
        title={t("setting.ai.tts-title")}
        description={t("setting.ai.tts-description")}
        showSeparator
        actions={
          <Button disabled={!ttsHasChanges} onClick={handleSaveTTS}>
            {t("common.save")}
          </Button>
        }
      >
        <TTSForm providers={speechProviders} tts={tts} onChange={setTts} referencedProvider={ttsProviderRef} />
      </SettingGroup>

      {/* ── AI 写作 ──────────────────────────────────────────── */}
      <SettingGroup
        title={t("setting.ai.writing-section-title")}
        description={t("setting.ai.writing-section-description")}
        showSeparator
        actions={
          <Button onClick={handleCreateWritingProvider}>
            <PlusIcon className="w-4 h-4 mr-2" />
            {t("setting.ai.add-writing-provider")}
          </Button>
        }
      >
        <SettingTable
          columns={providerColumns("writing")}
          data={writingProviders}
          emptyMessage={t("setting.ai.no-writing-providers")}
          getRowKey={(provider) => provider.id}
        />
      </SettingGroup>

      <SettingGroup
        title={t("setting.ai.writing-title")}
        description={t("setting.ai.writing-description")}
        showSeparator
        actions={
          <Button disabled={!writingHasChanges} onClick={handleSaveWriting}>
            {t("common.save")}
          </Button>
        }
      >
        <WritingForm providers={writingProviders} writing={writing} onChange={setWriting} referencedProvider={writingProviderRef} />
      </SettingGroup>

      <AIProviderDialog
        provider={editingProvider}
        mode={editingMode}
        onOpenChange={(open) => !open && setEditingProvider(undefined)}
        onSave={handleSaveProvider}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        title={deleteTarget ? t("setting.ai.delete-provider", { title: deleteTarget.title }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteProvider}
        confirmVariant="destructive"
      />
    </SettingSection>
  );
};

interface TranscriptionFormProps {
  providers: LocalAIProvider[];
  transcription: LocalTranscription;
  referencedProvider: LocalAIProvider | undefined;
  onChange: (next: LocalTranscription) => void;
}

const TranscriptionForm = ({ providers, transcription, referencedProvider, onChange }: TranscriptionFormProps) => {
  const t = useTranslate();
  const noProviders = providers.length === 0;

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.transcription-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const update = (partial: Partial<LocalTranscription>) => {
    onChange({ ...transcription, ...partial });
  };

  const placeholderForProvider = (provider: LocalAIProvider | undefined) => {
    if (!provider) return "";
    return provider.type === InstanceSetting_AIProviderType.GEMINI
      ? t("setting.ai.transcription-model-placeholder-gemini")
      : t("setting.ai.transcription-model-placeholder-openai");
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.transcription-provider")}</Label>
        <Select
          value={transcription.providerId || "__none__"}
          items={providerOptions}
          onValueChange={(value) => update({ providerId: value === "__none__" ? "" : value })}
          disabled={noProviders}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noProviders && <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-empty-providers")}</p>}
        {referencedProvider && !referencedProvider.apiKeySet && (
          <p className="text-xs text-destructive">{t("setting.ai.transcription-warning-no-key")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.transcription-model")}</Label>
        <Input
          value={transcription.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder={placeholderForProvider(referencedProvider)}
          disabled={!transcription.providerId}
          maxLength={256}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-model-help")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("setting.ai.transcription-language")}</Label>
        <Input
          value={transcription.language}
          onChange={(e) => update({ language: e.target.value })}
          placeholder={t("setting.ai.transcription-language-placeholder")}
          disabled={!transcription.providerId}
          maxLength={32}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-language-help")}</p>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.transcription-prompt")}</Label>
        <Textarea
          value={transcription.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder={t("setting.ai.transcription-prompt-placeholder")}
          rows={3}
          disabled={!transcription.providerId}
          maxLength={4096}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.transcription-prompt-help")}</p>
      </div>
    </div>
  );
};

interface AIProviderDialogProps {
  provider?: LocalAIProvider;
  mode: ProviderDialogMode;
  onOpenChange: (open: boolean) => void;
  onSave: (provider: LocalAIProvider) => void;
}

const AIProviderDialog = ({ provider, mode, onOpenChange, onSave }: AIProviderDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalAIProvider>(() => provider ?? newProvider());

  useEffect(() => {
    const next = provider ?? newProvider();
    setDraft(next);
  }, [provider]);

  const updateDraft = (partial: Partial<LocalAIProvider>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = () => {
    onSave(draft);
  };

  const keyless = isKeylessProviderType(draft.type);
  // Writing only speaks OpenAI Chat Completions — lock the type in that mode.
  const typeOptions = (mode === "writing" ? writingProviderTypeOptions : providerTypeOptions).map((type) => ({
    value: String(type),
    label: getProviderTypeLabel(type),
  }));

  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "writing"
              ? provider?.apiKeySet
                ? t("setting.ai.edit-writing-provider")
                : t("setting.ai.add-writing-provider")
              : provider?.apiKeySet
                ? t("setting.ai.edit-provider")
                : t("setting.ai.add-speech-provider")}
          </DialogTitle>
          <DialogDescription>
            {mode === "writing" ? t("setting.ai.writing-dialog-description") : t("setting.ai.speech-dialog-description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.provider-title")}</Label>
            <Input value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} placeholder="OpenAI" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.provider-type")}</Label>
            <Select
              value={String(draft.type)}
              items={typeOptions}
              onValueChange={(value) => updateDraft({ type: Number(value) as InstanceSetting_AIProviderType })}
              disabled={mode === "writing"}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === "writing" && <p className="text-xs text-muted-foreground">{t("setting.ai.writing-openai-only")}</p>}
          </div>

          {!keyless && (
            <>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>{t("setting.ai.endpoint")}</Label>
                <Input
                  value={draft.endpoint}
                  onChange={(e) => updateDraft({ endpoint: e.target.value })}
                  placeholder={getDefaultEndpointPlaceholder(draft.type)}
                />
                <p className="text-xs text-muted-foreground">{t("setting.ai.endpoint-hint")}</p>
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>{t("setting.ai.api-key")}</Label>
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => updateDraft({ apiKey: e.target.value })}
                  placeholder={draft.apiKeySet ? t("setting.ai.keep-api-key") : ""}
                />
                {draft.apiKeySet && (
                  <p className="text-xs text-muted-foreground">{t("setting.ai.current-key", { key: draft.apiKeyHint || "-" })}</p>
                )}
              </div>
            </>
          )}
          {keyless && (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">{t("setting.ai.edge-keyless-note")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const getDefaultEndpointPlaceholder = (type: InstanceSetting_AIProviderType) => {
  switch (type) {
    case InstanceSetting_AIProviderType.OPENAI:
      return "https://api.openai.com/v1";
    case InstanceSetting_AIProviderType.GEMINI:
      return "https://generativelanguage.googleapis.com/v1beta";
    case InstanceSetting_AIProviderType.VOLCENGINE_ARK:
      return "https://openspeech.bytedance.com/api/v3/plan";
    default:
      return "";
  }
};

interface TTSFormProps {
  providers: LocalAIProvider[];
  tts: LocalTTS;
  referencedProvider: LocalAIProvider | undefined;
  onChange: (next: LocalTTS) => void;
}

const TTSForm = ({ providers, tts, referencedProvider, onChange }: TTSFormProps) => {
  const t = useTranslate();
  const noProviders = providers.length === 0;
  const isEdgeProvider = referencedProvider?.type === InstanceSetting_AIProviderType.EDGE;

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.tts-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const edgeVoiceOptions = useMemo(() => EDGE_VOICES.map((voice) => ({ value: voice.shortName, label: voice.label })), []);

  const update = (partial: Partial<LocalTTS>) => {
    onChange({ ...tts, ...partial });
  };

  const handleProviderChange = (value: string) => {
    const providerId = value === "__none__" ? "" : value;
    const provider = providers.find((item) => item.id === providerId);
    if (provider?.type === InstanceSetting_AIProviderType.EDGE) {
      update({ providerId, model: "", speaker: tts.speaker || DEFAULT_EDGE_VOICE });
      return;
    }
    update({ providerId });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.tts-provider")}</Label>
        <Select value={tts.providerId || "__none__"} items={providerOptions} onValueChange={handleProviderChange} disabled={noProviders}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noProviders && <p className="text-xs text-muted-foreground">{t("setting.ai.tts-empty-providers")}</p>}
        {referencedProvider && !isEdgeProvider && !referencedProvider.apiKeySet && (
          <p className="text-xs text-destructive">{t("setting.ai.transcription-warning-no-key")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("setting.ai.tts-speaker")}</Label>
        {isEdgeProvider ? (
          <Select
            value={tts.speaker || DEFAULT_EDGE_VOICE}
            items={edgeVoiceOptions}
            onValueChange={(value) => update({ speaker: value })}
            disabled={!tts.providerId}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {edgeVoiceOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={tts.speaker}
            onChange={(e) => update({ speaker: e.target.value })}
            placeholder="zh_female_vv_uranus_bigtts"
            disabled={!tts.providerId}
            maxLength={128}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {isEdgeProvider ? t("setting.ai.tts-speaker-edge-help") : t("setting.ai.tts-speaker-help")}
        </p>
      </div>

      {!isEdgeProvider && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("setting.ai.tts-model")}</Label>
          <Input
            value={tts.model}
            onChange={(e) => update({ model: e.target.value })}
            placeholder="seed-tts-2.0"
            disabled={!tts.providerId}
            maxLength={128}
          />
          <p className="text-xs text-muted-foreground">{t("setting.ai.tts-model-help")}</p>
        </div>
      )}
    </div>
  );
};

interface WritingFormProps {
  providers: LocalAIProvider[];
  writing: LocalWriting;
  referencedProvider: LocalAIProvider | undefined;
  onChange: (next: LocalWriting) => void;
}

const WritingForm = ({ providers, writing, referencedProvider, onChange }: WritingFormProps) => {
  const t = useTranslate();
  const noProviders = providers.length === 0;

  const providerOptions = useMemo(
    () => [
      { value: "__none__", label: t("setting.ai.writing-no-provider") },
      ...providers.map((provider) => ({ value: provider.id, label: provider.title || provider.id })),
    ],
    [providers, t],
  );

  const update = (partial: Partial<LocalWriting>) => {
    onChange({ ...writing, ...partial });
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.writing-provider")}</Label>
        <Select
          value={writing.providerId || "__none__"}
          items={providerOptions}
          onValueChange={(value) => update({ providerId: value === "__none__" ? "" : value })}
          disabled={noProviders}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {noProviders ? (
          <p className="text-xs text-muted-foreground">{t("setting.ai.writing-empty-providers")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("setting.ai.writing-openai-only")}</p>
        )}
        {referencedProvider && !referencedProvider.apiKeySet && (
          <p className="text-xs text-destructive">{t("setting.ai.transcription-warning-no-key")}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.writing-model")}</Label>
        <Input
          value={writing.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder="gpt-4o-mini, deepseek-chat, qwen-plus"
          disabled={!writing.providerId}
          maxLength={256}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.writing-model-help")}</p>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label>{t("setting.ai.writing-system-prompt")}</Label>
        <Textarea
          value={writing.systemPrompt}
          onChange={(e) => update({ systemPrompt: e.target.value })}
          placeholder={t("setting.ai.writing-system-prompt-placeholder")}
          rows={5}
          disabled={!writing.providerId}
          maxLength={8192}
        />
        <p className="text-xs text-muted-foreground">{t("setting.ai.writing-system-prompt-help")}</p>
      </div>
    </div>
  );
};

export default AISection;
