# Menstrual Cycle Tracker Card

A custom Lovelace card for [Home Assistant](https://www.home-assistant.io/) that displays data from the [Menstrual Cycle Tracker](https://github.com/sjfehlen/flow-meter) integration.

## Features

- **Phase badge** — color-coded current cycle phase (🩸 Menstrual · 🌱 Follicular · 🥚 Ovulation · 🌙 Luteal)
- **Period status** — active/inactive indicator with day count, days left, or days until next period
- **Cycle progress bar** — segmented by phase with a dot marking today's position
- **Fertile window & PMS window** rows
- **Today's symptoms** displayed as chips
- **Average cycle / period length** stats
- **Visual editor** — fully configurable from the UI, no YAML required

## Requirements

- Home Assistant 2023.x or later
- [Menstrual Cycle Tracker](https://github.com/sjfehlen/flow-meter) integration installed and configured

## Installation

### HACS

1. In HACS, go to **Frontend** → click the three-dot menu → **Custom repositories**
2. Add `https://github.com/sjfehlen/flow-meter-card` with category **Lovelace**
3. Install **Menstrual Cycle Tracker Card**
4. Reload your browser

### Manual

1. Download `menstrual-cycle-tracker-card.js`
2. Copy it to your `config/www/` folder
3. In Home Assistant go to **Settings → Dashboards → Resources**
4. Add `/local/menstrual-cycle-tracker-card.js` as a **JavaScript module**
5. Reload your browser

## Usage

Add the card to any dashboard. In the visual editor:

| Option | Description | Default |
|--------|-------------|---------|
| Cycle Tracker | The **Period Active** binary sensor for your tracker | *(required)* |
| Card title | Title shown at the top | Tracker name |
| Subject | Subject pronoun used in labels (e.g. `You`, `She`, `They`) | `You` |
| Possessive | Possessive pronoun (e.g. `Your`, `Her`, `Their`) | `Your` |
| Show cycle progress bar | Segmented phase bar with today marker | on |
| Show fertile window | Fertile window status row | on |
| Show PMS window | PMS window status row | on |
| Show cycle stats | Average cycle / period length stats | on |

The card auto-discovers all other tracker entities from the selected Period Active sensor — no additional entity picking required.

## Related

- [Menstrual Cycle Tracker](https://github.com/sjfehlen/flow-meter) — the integration
- [Cycle Tracker Blueprints](https://github.com/sjfehlen/cycle-tracker-blueprints) — notification blueprints
