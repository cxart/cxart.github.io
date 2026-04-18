def return_linkedin(reasoning, linkedin_url):
    """
    Return the LinkedIn profile URL for a person.

    Args:
        reasoning (str): Explanation of how the LinkedIn profile was found or why it couldn't be found
        linkedin_url (str): The LinkedIn profile URL, or "None" if not found

    Returns:
        tuple: (reasoning, linkedin_url, additional_linkedins)
    """
    
    # Clean up the LinkedIn URL if provided
    if linkedin_url and linkedin_url.lower() != "none" and linkedin_url.strip():
        # Ensure it's a proper LinkedIn URL
        linkedin_url = linkedin_url.strip()
        
        if not linkedin_url.startswith("http"):
            if linkedin_url.startswith("linkedin.com"):
                linkedin_url = "https://" + linkedin_url
            elif linkedin_url.startswith("www.linkedin.com"):
                linkedin_url = "https://" + linkedin_url
            elif "/in/" in linkedin_url or "/pub/" in linkedin_url:
                # Make sure we use the full domain
                if linkedin_url.startswith("/"):
                    linkedin_url = "https://www.linkedin.com" + linkedin_url
                else:
                    linkedin_url = "https://www.linkedin.com/" + linkedin_url
            else:
                # If it doesn't look like a URL, mark as None
                linkedin_url = "None"
        
        # Validate that it's actually a LinkedIn URL
        if linkedin_url != "None" and "linkedin.com" not in linkedin_url.lower():
            linkedin_url = "None"
            
    else:
        linkedin_url = "None"
    
    # Return 3 values to match what the agent expects
    return reasoning, linkedin_url, ""