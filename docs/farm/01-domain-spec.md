# 01 — Zaroda Shamba: Domain

## The farm
- **Organization** = the farming business (an individual farmer, a family farm, a company, a group or co-op).
- **Branch** = a farm site. Most farms have one; an estate may have several (e.g. Uriri farm, Rongo farm).
- **Unit** (`farm_units`) = a named part of a farm: BLOCK, FIELD, PADDOCK, PEN, POULTRY_HOUSE, POND, APIARY, STORE,
  FEED_MILL. Units can nest (Field 3 inside Block B). Fields and paddocks carry `acres`.
- **Enterprise** (`farm_enterprises`) = a line of business on the farm: kind (DAIRY, BEEF, LAYERS, BROILERS, KIENYEJI,
  PIGS, GOATS, SHEEP, RABBITS, FISH, BEES, CROP, FODDER, FEED) plus a name ("Dairy herd", "Maize long rains").
  Every cost, income and record can be tagged to one, which is what makes profit per enterprise possible.

## Livestock
- **Animal** (`farm_animals`) — one identified animal: tag/ear number, name, species, breed, sex, date of birth (or
  estimated age), dam and sire (an animal or an AI bull code), group, unit, status (ACTIVE, SOLD, DIED, SLAUGHTERED,
  CULLED, LOST), source (BORN, BOUGHT) and purchase price.
- **Group / flock** (`farm_groups`) — animals kept and counted together: a poultry flock (placed date, breed, head
  count), a pig litter, a goat herd. Counts change only through events (placement, births, deaths, sales, transfers).
- Species: CATTLE, GOAT, SHEEP, PIG, CHICKEN, DUCK, TURKEY, RABBIT, FISH, BEE (hives), OTHER.

## Husbandry events (append-only; corrections are reversing entries)
- **Health** — sickness, diagnosis, treatment given (drug from stock, dose, who treated), cost.
- **Treatment withdrawal** — each drug has milk and meat withdrawal days. Until the later date passes, the animal's
  milk and meat are flagged **not for sale**; the POS refuses to sell flagged produce.
- **Vaccination / deworming / spraying (dip)** — scheduled programmes per species with repeat intervals; reminders at
  7/3/1 days and on the day.
- **Breeding** — heat seen, service (bull or AI straw + inseminator), pregnancy diagnosis, expected birth (cattle 283
  days, goats/sheep 150, pigs 114, rabbits 31), drying off (cows ~60 days before calving), birth with offspring
  registered automatically.
- **Weights and body condition**, **deaths** (cause), **movements** between units/farms, **sales and slaughter**.

## Production
- **Milk** — litres per cow per milking (AM/noon/PM), or per group for small farms; milk withheld (withdrawal) is
  recorded but not sellable; milk fed to calves; milk sold.
- **Eggs** — per flock per day: trays and pieces, broken, small; feed eaten; mortality — giving lay % and feed per egg.
- **Other produce** — honey, wool, manure, fish harvest, fingerlings, kids/calves sold.

## Crops
- **Season** (`farm_crop_seasons`) — a crop in a field for a season: crop, variety, acres, planting date, expected harvest.
- **Activities** — land preparation, planting, weeding, top dressing, spraying (chemical, rate, **pre-harvest interval**
  — harvest blocked until it passes), irrigation, harvest (bags/kg, grade), each with inputs drawn from stock and labour.
- Yield per acre, cost per acre and per kg.

## Feed production
- **Ration** (`farm_rations`) — a recipe: ingredients (stock items: maize germ, sunflower cake, fish meal, DCP,
  premix, molasses, napier/silage) with kg per batch; target species and stage (layers mash, dairy meal, piglet).
- **Mixing batch** — consumes ingredients from stock and produces finished feed stock, at its actual cost per kg.
- **Feeding** — kg given per group/animal per day, from stock; feed cost per animal, per litre of milk, per egg.

## Selling
- Produce and animals are sold through the POS as products (milk per litre, trays of eggs, a goat). Buyers can be
  walk-in, regular customers or institutions (co-op, hotel, school) on credit with statements.
- Produce under withdrawal cannot be sold.

## Money
- Costs (inputs, feed, drugs, vet, labour, transport) and income (sales) are tagged to an enterprise.
- Postings go to the farm's own general ledger (F7), with VAT through eTIMS where the farm is registered.
