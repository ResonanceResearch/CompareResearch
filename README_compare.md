
# Two‑School Research Comparison (scaffold)

This page reuses your single‑school exports to show UCVM vs OVC (or any two schools) side‑by‑side.

## How to set up

1. Create a new repo (or subfolder) and copy these files into the root:
   - `compare.html`
   - `compare.js`
   - `compare_config.json`
   - re‑use your existing `dashboard.css`

2. Create folders:
   - `data/UCVM/` with:
     - `roster_with_metrics.csv`
     - `openalex_all_authors_last5y_key_fields_dedup.csv`
     - `openalex_all_authors_last5y_key_fields_dedup_per_author.csv` (optional)
   - `data/OVC/` with the same three files.

   Tip: you can automate syncing from each single‑school repo's `data/` folder via GitHub Actions (artifact download or git submodules).

3. Open `compare_config.json` to change labels, colors, defaults, or add other schools.

4. Publish with GitHub Pages. Open `compare.html` in the browser.

## What it shows

- **Publications by year**: grouped bars (absolute or per‑capita). Per‑capita denominator can be "full‑time only" or all roster.
- **Cross‑school co‑authorship**: counts papers with at least one author from each school; shows a quick top‑pair summary.
- **Author–topic PCA**: per‑author topic sets (Topics by default; Concepts optional) -> Jaccard distances -> MDS to 2D; colored by school.
- **Strengths & gaps**: top per‑capita enrichments (log2 fold‑change) for A and B; shared and distinct lists.

## Adapting to other pairs

Add additional entries in `compare_config.json` and pick any two via the selectors.

## Notes

- The parser is strict about file locations; adjust paths if your repos differ.
- If you want department vs research‑group breakdowns, extend the denominator filter to read a column per school schema.
- For cross‑school network details and pairwise publication lists, extend with a table similar to your single‑school `coauthor-table`.
