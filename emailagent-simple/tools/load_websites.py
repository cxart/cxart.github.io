import requests
import time
from bs4 import BeautifulSoup

def load_websites(urls):
    """Load a website and return the HTML content and links."""
    print(f"Loading websites: {urls}")
    
    results = []
    for url in urls:
        time.sleep(2)  # Add delay to avoid rate limiting
        
        try:
            # Attempt to fetch the webpage with a reasonable timeout
            response = requests.get(url, timeout=20)
            
            if response.status_code != 200:
                print(f"Request for {url} failed. Status code: {response.status_code}")
                results.append({
                    "url": url, 
                    "text": f"Request error for {url}: {str(response.status_code)}. Don't try loading this page again.",
                    "links": []
                })
                continue
                
            # Parse the HTML content
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract all text
            full_text = soup.get_text(separator=' ', strip=True)
            
            # Extract all links and their text
            possible_emails = []
            for a_tag in soup.find_all('a'):
                link_text = a_tag.get_text(strip=True)
                link_url = a_tag.get('href')
                
                # Check if this might be an email link
                if link_url and ('mail' in link_url or '@' in link_url):
                    possible_emails.append({
                        "text": link_text,
                        "url": link_url
                    })
                elif link_text and ('mail' in link_text.lower() or 'contact' in link_text.lower() or '@' in link_text.lower()):
                    possible_emails.append({
                        "text": link_text,
                        "url": link_url
                    })

            # Store both the URL, its content, and links for reference
            results.append({
                "url": url, 
                "text": full_text,
                "possible_emails": possible_emails
            })
            
        except requests.exceptions.RequestException as e:
            results.append({
                "url": url, 
                "text": f"Request error for {url}: {str(e)}. Don't try loading this page again.",
                "links": []
            })
            print(f"Request error for {url}: {str(e)}")

    # Return all successfully fetched and processed pages
    return results