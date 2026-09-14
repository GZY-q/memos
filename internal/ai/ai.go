package ai

// ProviderType identifies an AI provider implementation.
type ProviderType string

const (
	// ProviderOpenAI is OpenAI's hosted API.
	ProviderOpenAI ProviderType = "OPENAI"
	// ProviderGemini is Google's Gemini API.
	ProviderGemini ProviderType = "GEMINI"
	// ProviderVolcengineArk is Volcengine Ark Agent Plan speech APIs.
	ProviderVolcengineArk ProviderType = "VOLCENGINE_ARK"
)

// ProviderConfig configures a callable AI provider connection.
type ProviderConfig struct {
	ID       string
	Title    string
	Type     ProviderType
	Endpoint string
	APIKey   string
}
