import json
import os

import requests
from dotenv import load_dotenv


load_dotenv()


def _get_serper_api_key() -> str:
    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        raise ValueError(
            "SERPER_API_KEY is not set. Add it to your environment or .env file."
        )
    return api_key


def search_web(search_query, number_of_results=30):
    """Search Serper and return normalized organic search results."""
    print(f"Searching for links for search term: '{search_query}'")

    search_query = search_query.strip()
    if (
        (search_query.startswith('"') and search_query.endswith('"'))
        or (search_query.startswith("'") and search_query.endswith("'"))
    ):
        search_query = search_query[1:-1]

    payload = json.dumps({"q": search_query, "num": number_of_results})
    headers = {
        "X-API-KEY": _get_serper_api_key(),
        "Content-Type": "application/json",
    }

    response = requests.post(
        "https://google.serper.dev/search",
        headers=headers,
        data=payload,
        timeout=30,
    )

    if response.status_code != 200:
        raise Exception(f"Serper API request failed with status code {response.status_code}")

    serper_response = response.json()
    organic = serper_response.get("organic", [])
    print(f"Serper API response received with {len(organic)} organic results")

    formatted_results = []
    for result in organic:
        formatted_results.append(
            {
                "title": result.get("title", ""),
                "href": result.get("link", ""),
                "body": result.get("snippet", ""),
            }
        )

    return formatted_results or None
