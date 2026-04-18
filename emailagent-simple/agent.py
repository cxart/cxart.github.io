import json
import os
import re
from pathlib import Path
from textwrap import dedent

import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

from inputs.prompt_config import load_system_prompt
from inputs.prompt_config_model_linkedin import load_system_prompt_model_linkedin
from tools.load_websites import load_websites
from tools.return_email import return_email
from tools.return_linkedin import return_linkedin
from tools.search_web import search_web


# Load .env values once so CLI and UI can both rely on env-based keys.
load_dotenv()


def _project_root() -> Path:
    return Path(__file__).resolve().parent


def _tools_config_path() -> Path:
    return _project_root() / "tools" / "tools_config.json"


def _default_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4.1-2025-04-14")


def _extract_tool_call(response):
    """Extract the most recent function/tool call from an OpenAI responses API reply."""
    candidates = getattr(response, "output", []) or []
    for item in reversed(candidates):
        item_type = getattr(item, "type", "")
        if item_type == "function_call" or hasattr(item, "name"):
            name = getattr(item, "name", None)
            arguments = getattr(item, "arguments", "{}")
            if name:
                return item, name, json.loads(arguments or "{}")
    raise ValueError("No function call returned by model")


class EmailAgent:
    def __init__(self, people_df, openai_api_key, verbose=False, model=None):
        self.people_df = people_df
        with open(_tools_config_path(), "r", encoding="utf-8") as f:
            self.tools = json.load(f)
        self.system_prompt = load_system_prompt()
        self.openai_api_key = openai_api_key
        self.model = model or _default_model()
        self.verbose = verbose
        self.logs = []

    def log(self, message, important=False):
        if important or self.verbose:
            print(message)
        self.logs.append(message)

    def initialize_messages(self, name, additional_info):
        return [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": (
                    f"Find the email address of {name}. "
                    f"Additional information about the person: {additional_info}"
                ),
            },
        ]

    def truncate_output(self, action_output, max_length=50000):
        email_patterns = [
            r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
            r"[a-zA-Z0-9._%+-]+\s*[\[\(]at[\]\)]\s*[a-zA-Z0-9.-]+\s*[\[\(]dot[\]\)]\s*[a-zA-Z]{2,}",
            r"[a-zA-Z0-9._%+-]+\s*\(at\)\s*[a-zA-Z0-9.-]+\s*\(dot\)\s*[a-zA-Z]{2,}",
            r"[a-zA-Z0-9._%+-]+\s*\[dot\]\s*[a-zA-Z0-9.-]+\s*\[at\]\s*[a-zA-Z]{2,}",
            r"[a-zA-Z0-9._%-]+\s*\[underscore\]\s*[a-zA-Z0-9.-]+\s*@\s*[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,}",
            r"j\*+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
            r"contact\s*(?:information|info|details|us)?",
            r"email|mail|contact|reach|write|get|in touch",
            r"(?:e-?mail|electronic mail)\s*(?:address)?",
            r"(?:get|reach|write)\s*(?:in)?\s*(?:touch|contact)",
        ]

        text_to_keep = []
        for pattern in email_patterns:
            for match in re.finditer(pattern, action_output, re.IGNORECASE):
                start_pos = max(0, match.start() - 200)
                end_pos = min(len(action_output), match.end() + 200)
                text_to_keep.append(action_output[start_pos:end_pos])

        if text_to_keep:
            self.log(
                "Potential email information found in long output; preserving relevant sections",
                important=True,
            )
            preserved_text = "\n\n[...]\n\n".join(text_to_keep)
            return (
                "Original output was too long. Here are relevant sections that may "
                "contain contact information:\n\n"
                + preserved_text
                + "\n\n[... Rest of output truncated due to length ...]"
            )

        self.log(
            f"Output too long ({len(action_output)} chars) and no email content detected. Truncating..."
        )
        return action_output[:max_length] + "\n\n[... Output truncated due to length ...]"

    def generate_user_prompt(self, action_output, name, max_length=100000):
        if action_output and len(action_output) > max_length:
            action_output = self.truncate_output(action_output, max_length)

        user_prompt = dedent(
            f"""
            Your previous action resulted in the following output:
            {action_output}
            Please generate a new action to find the email address of the person named {name}.
            """
        )
        return {"role": "user", "content": user_prompt}

    def generate_action(self, messages):
        client = OpenAI(api_key=self.openai_api_key)
        try:
            response = client.responses.create(
                model=self.model,
                input=messages,
                tools=self.tools["tools"],
                tool_choice="required",
                parallel_tool_calls=False,
                temperature=0.0,
            )
            assistant_output, action, args = _extract_tool_call(response)
            return assistant_output, action, args
        except Exception as e:
            self.log(f"Error in generate_action: {e}", important=True)
            return (
                f"An error occurred while generating an action: {e}",
                "return_email",
                {
                    "reasoning": f"Failed to complete search due to an error: {e}",
                    "email": "None",
                    "additional_emails": [],
                    "email_source": "",
                },
            )

    def execute_action(self, action, args):
        action_map = {
            "search_web": search_web,
            "load_websites": load_websites,
            "return_email": return_email,
            "return_linkedin": return_linkedin,
        }
        if action not in action_map:
            raise ValueError(f"Unknown action: {action}")
        return action_map[action](**args)

    def find_email_address(self, name, additional_info, max_iterations=15):
        action_outputs = []
        messages = self.initialize_messages(name, additional_info)
        loop_count = 0

        while True:
            if loop_count >= max_iterations:
                return f"Request for {name} timed out", None, None, None

            if action_outputs:
                messages.append(self.generate_user_prompt(action_outputs[-1], name))

            assistant_output, action, args = self.generate_action(messages)
            messages.append({"role": "assistant", "content": str(assistant_output)})

            action_output = self.execute_action(action, args)
            action_outputs.append(action_output)

            if action == "return_email":
                if isinstance(action_output, tuple):
                    if len(action_output) == 4:
                        reasoning, email, additional_emails, email_source = action_output
                    elif len(action_output) == 3:
                        reasoning, email, additional_emails = action_output
                        email_source = ""
                    elif len(action_output) == 2:
                        reasoning, email = action_output
                        additional_emails = ""
                        email_source = ""
                    else:
                        reasoning = action_output[0] if action_output else "No reasoning provided"
                        email = None
                        additional_emails = ""
                        email_source = ""
                else:
                    reasoning = str(action_output) if action_output else "No reasoning provided"
                    email = None
                    additional_emails = ""
                    email_source = ""

                return reasoning, email, additional_emails, email_source

            loop_count += 1

    def find_email_addresses(
        self,
        email_column="agent_email",
        original_df=None,
        csv_path=None,
        save_every=1,
        name_column=None,
        max_output_length=50000,
    ):
        _ = max_output_length  # Kept for compatibility with original CLI signature.

        if email_column not in self.people_df.columns:
            self.people_df[email_column] = pd.Series(dtype="string")
        if "agent_additional_emails" not in self.people_df.columns:
            self.people_df["agent_additional_emails"] = pd.Series(dtype="string")
        if "email_source" not in self.people_df.columns:
            self.people_df["email_source"] = pd.Series(dtype="string")
        if "agent_linkedin" not in self.people_df.columns:
            self.people_df["agent_linkedin"] = pd.Series(dtype="string")

        indices_to_process = self.people_df.index
        if original_df is not None and name_column and email_column in original_df.columns:
            normalized_df = original_df.copy()
            for col in [email_column, "agent_additional_emails", "email_source", "agent_linkedin"]:
                if col not in normalized_df.columns:
                    normalized_df[col] = pd.Series(dtype="string")
                else:
                    normalized_df[col] = normalized_df[col].astype("string")

            empty_mask = normalized_df[email_column].isna() | (normalized_df[email_column] == "")
            contactout_mask = normalized_df["email_source"].str.contains(
                "contactout.com", case=False, na=False
            )
            names_to_process = normalized_df.loc[empty_mask | contactout_mask, name_column]
            indices_to_process = self.people_df[self.people_df["name"].isin(names_to_process)].index

        processed_count = 0
        total_to_process = len(indices_to_process)
        self.log(
            f"Processing {total_to_process} entries that need email lookup or rechecking",
            important=True,
        )

        working_df = None
        if original_df is not None:
            working_df = original_df.copy()
            for col in [email_column, "agent_additional_emails", "email_source", "agent_linkedin"]:
                if col not in working_df.columns:
                    working_df[col] = pd.Series(dtype="string")
                else:
                    working_df[col] = working_df[col].astype("string")

        linkedin_agent = None
        if original_df is not None:
            linkedin_agent = LinkedInAgent(
                self.people_df,
                self.openai_api_key,
                verbose=self.verbose,
                model=self.model,
            )

        for idx in indices_to_process:
            if idx not in self.people_df.index:
                continue

            row = self.people_df.loc[idx]
            self.log(f"Processing {row['name']} ({processed_count + 1}/{total_to_process})", important=True)

            reasoning, email, additional_emails, source_url = self.find_email_address(
                row["name"], row["additional_info"]
            )

            _ = reasoning  # retained in case caller wants debug logs in future
            email = "None" if email is None or email == "" else str(email)
            source_url = "None" if source_url is None or source_url == "" else str(source_url)
            extra_emails = "None" if additional_emails is None or additional_emails == "" else (
                "; ".join(additional_emails)
                if isinstance(additional_emails, (list, tuple))
                else str(additional_emails)
            )

            self.people_df.at[idx, email_column] = email
            self.people_df.at[idx, "agent_additional_emails"] = extra_emails
            self.people_df.at[idx, "email_source"] = source_url
            self.log(f"Found email for {row['name']}: {email}", important=True)

            matching_rows = 0
            name_mask = None
            if working_df is not None and name_column:
                name_mask = working_df[name_column] == row["name"]
                matching_rows = int(name_mask.sum())
                if matching_rows > 0:
                    working_df.loc[name_mask, email_column] = email
                    working_df.loc[name_mask, "agent_additional_emails"] = extra_emails
                    working_df.loc[name_mask, "email_source"] = source_url

            if csv_path and working_df is not None and (processed_count + 1) % save_every == 0:
                working_df.to_csv(csv_path, index=False)
                self.log(
                    f"Saved progress to {csv_path} after {processed_count + 1} entries",
                    important=True,
                )

            if email == "None" and linkedin_agent is not None:
                self.log(
                    f"No email found for {row['name']}, searching for LinkedIn profile...",
                    important=True,
                )
                _, linkedin_url, _ = linkedin_agent.find_linkedin_profile(
                    row["name"], row["additional_info"]
                )
                linkedin_url = (
                    "None"
                    if linkedin_url is None or linkedin_url == "" or str(linkedin_url).lower() == "none"
                    else str(linkedin_url)
                )
                self.people_df.at[idx, "agent_linkedin"] = linkedin_url

                if working_df is not None and name_mask is not None and matching_rows > 0:
                    working_df.loc[name_mask, "agent_linkedin"] = linkedin_url

            processed_count += 1

        if csv_path and working_df is not None:
            working_df.to_csv(csv_path, index=False)
            self.log(f"Saved final results to {csv_path}", important=True)

        return working_df if working_df is not None else self.people_df


class LinkedInAgent:
    def __init__(self, people_df, openai_api_key, verbose=False, model=None):
        self.people_df = people_df
        with open(_tools_config_path(), "r", encoding="utf-8") as f:
            self.tools = json.load(f)
        self.system_prompt = load_system_prompt_model_linkedin()
        self.openai_api_key = openai_api_key
        self.model = model or _default_model()
        self.verbose = verbose
        self.logs = []

    def log(self, message, important=False):
        if important or self.verbose:
            print(message)
        self.logs.append(message)

    def initialize_messages(self, name, additional_info):
        return [
            {"role": "system", "content": self.system_prompt},
            {
                "role": "user",
                "content": (
                    f"Find the LinkedIn profile of {name}. "
                    f"Additional information about the person: {additional_info}"
                ),
            },
        ]

    def truncate_output(self, action_output, max_length=50000):
        linkedin_patterns = [
            r"linkedin\.com/in/[a-zA-Z0-9\-]+",
            r"linkedin\.com/pub/[a-zA-Z0-9\-]+",
            r"linkedin\.com/profile/view\?id=",
            r"professional\s*profile",
            r"linkedin|linked\s*in",
            r"professional\s*(?:network|networking)",
            r"contact\s*(?:information|info|details)",
            r"professional\s*(?:background|experience)",
        ]

        text_to_keep = []
        for pattern in linkedin_patterns:
            for match in re.finditer(pattern, action_output, re.IGNORECASE):
                start_pos = max(0, match.start() - 200)
                end_pos = min(len(action_output), match.end() + 200)
                text_to_keep.append(action_output[start_pos:end_pos])

        if text_to_keep:
            self.log(
                "Potential LinkedIn information found in long output; preserving relevant sections",
                important=True,
            )
            preserved_text = "\n\n[...]\n\n".join(text_to_keep)
            return (
                "Original output was too long. Here are relevant sections that may "
                "contain LinkedIn information:\n\n"
                + preserved_text
                + "\n\n[... Rest of output truncated due to length ...]"
            )

        self.log(
            f"Output too long ({len(action_output)} chars) and no LinkedIn content detected. Truncating..."
        )
        return action_output[:max_length] + "\n\n[... Output truncated due to length ...]"

    def generate_user_prompt(self, action_output, name, max_length=100000):
        if action_output and len(action_output) > max_length:
            action_output = self.truncate_output(action_output, max_length)

        user_prompt = dedent(
            f"""
            Your previous action resulted in the following output:
            {action_output}
            Please generate a new action to find the LinkedIn profile of the person named {name}.
            """
        )
        return {"role": "user", "content": user_prompt}

    def generate_action(self, messages):
        client = OpenAI(api_key=self.openai_api_key)
        try:
            response = client.responses.create(
                model=self.model,
                input=messages,
                tools=self.tools["tools"],
                tool_choice="required",
                parallel_tool_calls=False,
                temperature=0.0,
            )
            assistant_output, action, args = _extract_tool_call(response)
            return assistant_output, action, args
        except Exception as e:
            self.log(f"Error in generate_action: {e}", important=True)
            return (
                f"An error occurred while generating an action: {e}",
                "return_linkedin",
                {
                    "reasoning": f"Failed to complete search due to an error: {e}",
                    "linkedin_url": "None",
                },
            )

    def execute_action(self, action, args):
        action_map = {
            "search_web": search_web,
            "load_websites": load_websites,
            "return_email": return_email,
            "return_linkedin": return_linkedin,
        }
        if action not in action_map:
            raise ValueError(f"Unknown action: {action}")
        return action_map[action](**args)

    def find_linkedin_profile(self, name, additional_info, max_iterations=15):
        action_outputs = []
        messages = self.initialize_messages(name, additional_info)
        loop_count = 0

        while True:
            if loop_count >= max_iterations:
                return f"Request for {name} timed out", "None", ""

            if action_outputs:
                messages.append(self.generate_user_prompt(action_outputs[-1], name))

            assistant_output, action, args = self.generate_action(messages)
            messages.append({"role": "assistant", "content": str(assistant_output)})

            action_output = self.execute_action(action, args)
            action_outputs.append(action_output)

            if action == "return_linkedin":
                if isinstance(action_output, tuple):
                    if len(action_output) == 3:
                        reasoning, linkedin, additional_linkedins = action_output
                    elif len(action_output) == 2:
                        reasoning, linkedin = action_output
                        additional_linkedins = ""
                    else:
                        reasoning = action_output[0] if action_output else "No reasoning provided"
                        linkedin = "None"
                        additional_linkedins = ""
                else:
                    reasoning = str(action_output) if action_output else "No reasoning provided"
                    linkedin = "None"
                    additional_linkedins = ""

                return reasoning, linkedin, additional_linkedins

            loop_count += 1

    def find_linkedin_profiles(
        self,
        linkedin_column="agent_linkedin",
        original_df=None,
        csv_path=None,
        save_every=1,
        name_column=None,
        max_output_length=50000,
    ):
        _ = max_output_length  # Kept for compatibility with original CLI signature.

        if linkedin_column not in self.people_df.columns:
            self.people_df[linkedin_column] = pd.Series(dtype="string")

        indices_to_process = self.people_df.index
        if original_df is not None and name_column and linkedin_column in original_df.columns:
            normalized_df = original_df.copy()
            if normalized_df[linkedin_column].dtype != "string":
                normalized_df[linkedin_column] = normalized_df[linkedin_column].astype("string")
            empty_mask = normalized_df[linkedin_column].isna() | (normalized_df[linkedin_column] == "")
            names_to_process = normalized_df.loc[empty_mask, name_column]
            indices_to_process = self.people_df[self.people_df["name"].isin(names_to_process)].index

        processed_count = 0
        total_to_process = len(indices_to_process)
        self.log(f"Processing {total_to_process} entries that need LinkedIn lookup", important=True)

        working_df = None
        if original_df is not None:
            working_df = original_df.copy()
            if linkedin_column not in working_df.columns:
                working_df[linkedin_column] = pd.Series(dtype="string")
            else:
                working_df[linkedin_column] = working_df[linkedin_column].astype("string")

        for idx in indices_to_process:
            if idx not in self.people_df.index:
                continue

            row = self.people_df.loc[idx]
            self.log(f"Processing {row['name']} ({processed_count + 1}/{total_to_process})", important=True)

            _, linkedin_url, _ = self.find_linkedin_profile(row["name"], row["additional_info"])
            linkedin_url = (
                "None"
                if linkedin_url is None or linkedin_url == "" or str(linkedin_url).lower() == "none"
                else str(linkedin_url)
            )

            self.people_df.at[idx, linkedin_column] = linkedin_url

            if working_df is not None and name_column:
                name_mask = working_df[name_column] == row["name"]
                if int(name_mask.sum()) > 0:
                    working_df.loc[name_mask, linkedin_column] = linkedin_url

            if csv_path and working_df is not None and (processed_count + 1) % save_every == 0:
                working_df.to_csv(csv_path, index=False)
                self.log(
                    f"Saved progress to {csv_path} after {processed_count + 1} entries",
                    important=True,
                )

            processed_count += 1

        if csv_path and working_df is not None:
            working_df.to_csv(csv_path, index=False)
            self.log(f"Saved final results to {csv_path}", important=True)

        return working_df if working_df is not None else self.people_df
