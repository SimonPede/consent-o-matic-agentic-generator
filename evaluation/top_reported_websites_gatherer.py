import requests
from bs4 import BeautifulSoup

URL = "https://gdprconsent.projects.cavi.au.dk/reports.php"
N = 100

EXCLUDE_ALL_COMMENTS = True

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

        comment = cells[2].get_text(strip=True)

        if exclude_all_comments:
            if comment:
                continue
        else:
            if "#nowayout" in comment:
                continue

        entries.append({"reports": reports, "site": site, "comment": comment})
        
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

            if site.startswith("//"):
                site = f"https:{site}"
            elif not site.startswith(("http://", "https://")):
                site = f"https://{site}"
                
            f.write(site + "\n")
    
    print(f"\nWrote {len(top_sites)} URLs to {output_path}")