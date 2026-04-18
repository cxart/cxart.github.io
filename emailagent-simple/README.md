# EmailAgent Simple

A simplified, shareable version of the EmailAgent project.

## 1. Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create your local env file:

```bash
cp .env.example .env
```

Then fill in:
- `OPENAI_API_KEY`
- `SERPER_API_KEY`

## 2. Easy UI (recommended)

```bash
streamlit run app.py
```

Flow:
1. Upload CSV
2. Select name column (+ optional extra-info column)
3. Choose mode: Email only / LinkedIn only / Both
4. Run
5. Download updated CSV

## 2b. Super-simple Single-Person HTML Demo

If you want a single clickable file for a quick demo:

1. Open `/Users/cxart/Desktop/EmailAgent-SimpleUI/single_person_lookup.html`
2. Enter your OpenAI API key
3. Enter one person's name + optional details
4. Click **Search Contact Info**

The page returns:
- best email
- LinkedIn URL
- extra emails
- sources and reasoning

If direct file-open fails due browser CORS rules, run:

```bash
cd /Users/cxart/Desktop/EmailAgent-SimpleUI
python3 -m http.server
```

Then open:

`http://localhost:8000/single_person_lookup.html`

## 3. CLI usage

### Find emails

```bash
python find_emails.py datasets/authors_demo.csv author_name
```

Optional:

```bash
python find_emails.py your_file.csv name_column custom_email_col --additional_info_column company
```

### Find LinkedIn

```bash
python find_linkedin.py datasets/authors_demo.csv author_name
```

Optional:

```bash
python find_linkedin.py your_file.csv name_column custom_linkedin_col --additional_info_column title
```

## Output columns

Email flow creates:
- `agent_email` (or custom email column)
- `agent_additional_emails`
- `email_source`
- `agent_linkedin` (fallback LinkedIn lookup when email is `None`)

LinkedIn flow creates:
- `agent_linkedin` (or custom LinkedIn column)

## GitHub sharing checklist

Before pushing:
1. Confirm `.env` is not committed
2. Confirm no API keys in code/files
3. Push project folder
4. Tell your friend to copy `.env.example` to `.env` and add their own keys

## Notes

- Default model is `gpt-4.1-2025-04-14`.
- You can override via `.env` (`OPENAI_MODEL=...`) or the UI field.
