import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse

URL = "https://gdprconsent.projects.cavi.au.dk/reports.php"
N = 100

BLOCKED_HOSTS = [
    "myprivacy.dpgmedia.nl", #not supported anymore
    "www.heise.de", #known dual-iframe pattern
    "www.spiegel.de", #known dual-iframe pattern
    "mdjildafknihdffpkfmmpnpoiajfjnjd"
]
EXCLUDE_ALL_COMMENTS = True

def normalize_to_http(url: str) -> str:
    url = url.strip()
    if url.startswith("//"):
        return f"https:{url}"
    if not url.startswith(("http://", "https://")):
        return f"https://{url}"
    return url


def extract_host_safe(url: str) -> str | None:
    """Returns normalized hostname or None for malformed URLs."""
    try:
        host = urlparse(url).netloc.lower().rstrip(".")
        return host or None
    except ValueError:
        #Some rows contain malformed hrefs (e.g. invalid IPv6-like patterns).
        return None

def fetch_sites(n=N, exclude_all_comments=EXCLUDE_ALL_COMMENTS):
    response = requests.get(URL, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    
    table = soup.find("table")
    if table is None:
        raise RuntimeError("No table found on the page: check if the page structure changed.")

    rows = table.find_all("tr")[1:]
    
    entries = []
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 2:
            continue

        reports_text = cells[0].get_text(strip=True)
        try:
            reports = int(reports_text)
        except ValueError:
            continue

        link = cells[1].find("a")
        site = link["href"].strip() if link and link.get("href") else cells[1].get_text(strip=True)
        
        normalized_site = normalize_to_http(site)
        host = extract_host_safe(normalized_site)
        if host is None:
            continue

        if host in BLOCKED_HOSTS:
            continue

        comment = cells[2].get_text(strip=True)

        if exclude_all_comments:
            if comment:
                continue
        else:
            if "#nowayout" in comment:
                continue

        entries.append({"reports": reports, "site": normalized_site, "comment": comment})
        
    return entries[:n]

if __name__ == "__main__":
    top_sites = fetch_sites()
    
    for i, entry in enumerate(top_sites, start=1):
        print(f"{i}. {entry['site']} ({entry['reports']} reports)")
    print(f"\nTotal: {len(top_sites)} sites")
    
    output_path = "reported_urls.txt"
    with open(output_path, "w", encoding="utf-8") as f:
        for entry in top_sites:
            site = entry["site"]
            
            f.write(site + "\n")
    
    print(f"\nWrote {len(top_sites)} URLs to {output_path}")