def return_email(reasoning: str,
                 email: str,
                 additional_emails: str = "",
                 email_source: str = ""):
    """
    reasoning           – why we think this is the right email
    email               – the best/primary email we found
    additional_emails   – any backups / alternates, comma‑separated
    email_source        – *URL of the page that contained **email***   ← NEW
    """
    return reasoning, email, additional_emails, email_source
