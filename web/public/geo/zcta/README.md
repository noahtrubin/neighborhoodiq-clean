# ZCTA boundary chunks

Real ZIP-code (ZCTA) boundary polygons for the landing globe, one TopoJSON per
state, lazy-loaded by `GlobeLandingHero` the first time a user flies into that
state. Filtered to the scored ZIPs in `web/app-data/national_scores.json`
(PO-box-style ZIPs have no ZCTA and keep centroid dots).

Source: Census cartographic boundary file `cb_2020_us_zcta520_500k`
(https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip).

Regenerate (from a scratch dir containing the unzipped shapefile):

```sh
# 1. zip → state join table from the scored dataset
node -e '
const d = require("<repo>/web/app-data/national_scores.json");
const rows = ["zip,st"];
for (const z of d) rows.push(z.zip + "," + z.state);
require("fs").writeFileSync("zipstates.csv", rows.join("\n"));'

# 2. filter, simplify, split per state (topology-aware: shared borders stay shared)
mkdir -p out
NODE_OPTIONS=--max-old-space-size=6144 npx mapshaper cb_2020_us_zcta520_500k.shp \
  -join zipstates.csv keys=GEOID20,zip string-fields=zip fields=st \
  -filter 'st != null' \
  -simplify weighted 25% keep-shapes \
  -clean \
  -each 'zip=GEOID20' \
  -filter-fields zip,st \
  -split st \
  -o out format=topojson singles extension=".json"

# 3. copy out/*.json into this folder
```

Each file's TopoJSON object is keyed by the state abbreviation (e.g.
`objects.NY`) and every geometry carries a `zip` property.
