from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    redis_url: str
    elasticsearch_url: str = "http://elasticsearch:9200"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    source_encryption_key: str
    congress_api_key: str | None = None
    courtlistener_api_key: str | None = None
    internet_archive_url: str = "https://archive.org"
    muckrock_api_url: str | None = None
    documentcloud_api_key: str | None = None
    documentcloud_api_url: str | None = None
    secure_drop_url: str | None = None
    allowed_sensitive_cidrs: str = "127.0.0.1/32"
    cors_origins: str = "http://localhost:5173"
    air_gapped_mode: bool = False
    retention_days: int = 2555
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
