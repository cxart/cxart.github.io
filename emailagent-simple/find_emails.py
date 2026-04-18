import argparse
import os

import pandas as pd

from agent import EmailAgent
from config import get_api_keys


def main():
    parser = argparse.ArgumentParser(
        description="Find email addresses for people listed in a CSV file"
    )
    parser.add_argument("csv_path", type=str, help="Path to CSV file containing names")
    parser.add_argument("name_column", type=str, help="Column name containing people's names")
    parser.add_argument(
        "email_column",
        type=str,
        nargs="?",
        default="agent_email",
        help="Column name to save email addresses (default: agent_email)",
    )
    parser.add_argument(
        "--additional_info_column",
        type=str,
        default=None,
        help="Optional: Column with additional context (company/title/etc.)",
    )
    parser.add_argument(
        "--save_frequency",
        type=int,
        default=1,
        help="How often to save results to CSV (default: 1)",
    )
    parser.add_argument(
        "--max_output_length",
        type=int,
        default=50000,
        help="Maximum length of output to process (default: 50000)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Optional model override (defaults to OPENAI_MODEL or gpt-4.1-2025-04-14)",
    )
    args = parser.parse_args()

    openai_api_key, _ = get_api_keys()

    try:
        try:
            df = pd.read_csv(args.csv_path)
        except UnicodeDecodeError:
            print("Trying alternative encoding latin-1...")
            df = pd.read_csv(args.csv_path, encoding="latin-1")
    except FileNotFoundError:
        print(f"Error: Could not find CSV file at {args.csv_path}")
        return
    except pd.errors.EmptyDataError:
        print(f"Error: The CSV file at {args.csv_path} is empty")
        return

    if args.name_column not in df.columns:
        print(f"Error: Column '{args.name_column}' not found in CSV.")
        print(f"Available columns: {', '.join(df.columns)}")
        return

    if args.additional_info_column and args.additional_info_column in df.columns:
        people_df = df[[args.name_column, args.additional_info_column]].copy()
        people_df.columns = ["name", "additional_info"]
        print(f"Using additional info from column: {args.additional_info_column}")
    else:
        people_df = df[[args.name_column]].copy()
        people_df.columns = ["name"]
        people_df["additional_info"] = ""
        if args.additional_info_column:
            print(
                f"Warning: Column '{args.additional_info_column}' not found. Proceeding without additional info."
            )

    os.makedirs("outputs", exist_ok=True)

    try:
        print(f"Initializing EmailAgent to process {len(people_df)} people...")
        agent = EmailAgent(
            people_df,
            openai_api_key,
            verbose=True,
            model=args.model,
        )

        agent.find_email_addresses(
            email_column=args.email_column,
            original_df=df,
            csv_path=args.csv_path,
            save_every=args.save_frequency,
            name_column=args.name_column,
            max_output_length=args.max_output_length,
        )

        print("\nEmail search completed.")
        print(f"Results saved to: {args.csv_path}")
        print(f"Email column: {args.email_column}")
        print("Additional columns created: agent_additional_emails, email_source")
    except Exception as e:
        print(f"An error occurred while running the email agent: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    main()
