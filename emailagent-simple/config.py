import os

from dotenv import load_dotenv


load_dotenv()


def get_api_keys():
    """Read API keys from environment or .env file."""
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    serper_api_key = os.getenv("SERPER_API_KEY", "").strip()

    if not openai_api_key:
        raise ValueError("Please set OPENAI_API_KEY in your environment or .env file.")
    if not serper_api_key:
        raise ValueError("Please set SERPER_API_KEY in your environment or .env file.")

    return openai_api_key, serper_api_key
