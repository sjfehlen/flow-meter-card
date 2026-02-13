'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────

const DOMAIN = 'menstrual_cycle_tracker';

const PHASE_META = {
  Menstrual:  { color: '#e57373', bg: 'rgba(229,115,115,.15)', icon: '🩸' },
  Follicular: { color: '#66bb6a', bg: 'rgba(102,187,106,.15)', icon: '🌱' },
  Ovulation:  { color: '#ffca28', bg: 'rgba(255,202,40,.15)',  icon: '🥚' },
  Luteal:     { color: '#ab47bc', bg: 'rgba(171,71,188,.15)',  icon: '🌙' },
  Unknown:    { color: 'var(--secondary-text-color)', bg: 'rgba(0,0,0,.06)', icon: '—' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/** HTML-escape a value for safe insertion. */
const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/** Read the state string of an entity. */
const st  = (hass, id) => hass.states[id]?.state ?? null;

/** Read an attribute from an entity. */
const att = (hass, id, key) => hass.states[id]?.attributes?.[key] ?? null;

/** Derive all sibling entity IDs from the period_active binary_sensor ID. */
function deriveEntities(periodActiveId) {
  const slug = periodActiveId.replace(/^binary_sensor\./, '').replace(/_period_active$/, '');
  return {
    periodActive:   periodActiveId,
    currentPhase:   `sensor.${slug}_current_phase`,
    cycleDay:       `sensor.${slug}_cycle_day`,
    nextPeriod:     `sensor.${slug}_next_period`,
    periodLength:   `sensor.${slug}_period_length`,
    cycleLength:    `sensor.${slug}_cycle_length`,
    fertileWindow:  `sensor.${slug}_fertile_window`,
    todaysSymptoms: `sensor.${slug}_todays_symptoms`,
  };
}

/** Format an ISO date string (YYYY-MM-DD) → "Jan 15" */
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const [, m, d] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
  } catch { return iso; }
}

/** Plural suffix */
const pl = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── Row builder ────────────────────────────────────────────────────────────────

function infoRow(icon, label, value, valueColor, entityId) {
  const style = valueColor ? ` style="color:${esc(valueColor)}"` : '';
  const entity = entityId ? ` data-entity="${esc(entityId)}"` : '';
  return `
    <div class="row${entityId ? ' clickable' : ''}"${entity}>
      <ha-icon icon="${esc(icon)}"></ha-icon>
      <span class="row-label">${esc(label)}</span>
      <span class="row-value"${style}>${esc(value)}</span>
    </div>`;
}

// ── Visual editor schema ───────────────────────────────────────────────────────

const SCHEMA = [
  {
    name: 'entity', required: true,
    label: 'Cycle Tracker (Period Active sensor)',
    selector: { entity: { domain: 'binary_sensor', integration: 'menstrual_cycle_tracker' } },
  },
  { name: 'title',        label: 'Card title (blank = tracker name)',              selector: { text: {} } },
  { name: 'subject',      label: 'Subject pronoun — e.g. "You", "She", "They"',   selector: { text: {} } },
  { name: 'possessive',   label: 'Possessive — e.g. "Your", "Her", "Their"',      selector: { text: {} } },
  { name: 'show_cycle_bar',   label: 'Show cycle progress bar',            selector: { boolean: {} } },
  { name: 'show_next',        label: 'Show next period date',              selector: { boolean: {} } },
  { name: 'show_fertile',     label: 'Show fertile window row',            selector: { boolean: {} } },
  { name: 'show_pms',         label: 'Show PMS window row',                selector: { boolean: {} } },
  { name: 'show_last',        label: 'Show last period start / end dates', selector: { boolean: {} } },
  { name: 'show_stats',       label: 'Show avg cycle / period length',     selector: { boolean: {} } },
  { name: 'show_symptoms',    label: "Show today's symptoms",              selector: { boolean: {} } },
  { name: 'show_log_buttons', label: 'Show Log Period Start / End buttons', selector: { boolean: {} } },
];

// ── Card ───────────────────────────────────────────────────────────────────────

class MenstrualCycleTrackerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config  = null;
    this._hass    = null;
    this._ent     = null;
    this._pending = null; // 'start' | 'end' — log service call in-flight

    // ── Single event-delegation listener (survives innerHTML replacements) ──
    this.shadowRoot.addEventListener('click', (e) => {
      // Log period buttons
      const logBtn = e.target.closest('.log-btn');
      if (logBtn && !logBtn.disabled) {
        e.stopPropagation();
        const action = logBtn.dataset.action;
        if (action) this._log(action);
        return;
      }

      // More-info on clickable rows / elements
      const clickable = e.target.closest('[data-entity]');
      if (clickable) {
        e.stopPropagation();
        this._showMoreInfo(clickable.dataset.entity);
        return;
      }
    });
  }

  static getConfigElement() {
    return document.createElement('menstrual-cycle-tracker-card-editor');
  }

  static getStubConfig() {
    return {
      entity: '',
      title: '',
      subject: 'You',
      possessive: 'Your',
      show_cycle_bar:       true,
      show_next:            true,
      show_fertile:         true,
      show_pms:             true,
      show_last:            false,
      show_stats:           true,
      show_symptoms:        true,
      show_log_buttons:     true,
    };
  }

  setConfig(config) {
    if (!config.entity) throw new Error('Set the Period Active entity in the card editor.');
    this._config = config;
    this._ent    = deriveEntities(config.entity);
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  // ── Service calls ────────────────────────────────────────────────────────────

  async _log(action) {
    if (this._pending) return;
    this._pending = action;
    this._render();

    const service = action === 'start' ? 'log_period_start' : 'log_period_end';

    // Resolve config_entry_id so the integration knows which tracker to target.
    if (!this._trackerId) {
      try {
        const entry = await this._hass.callWS({
          type: 'config/entity_registry/get',
          entity_id: this._config.entity,
        });
        this._trackerId = entry?.config_entry_id;
      } catch { /* leave undefined */ }
    }

    try {
      await this._hass.callService(
        DOMAIN, service,
        this._trackerId ? { tracker: this._trackerId } : {},
      );
      setTimeout(() => { this._pending = null; this._render(); }, 2500);
    } catch {
      this._pending = null;
      this._render();
    }
  }

  _showMoreInfo(entityId) {
    if (!entityId) return;
    const event = new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  _render() {
    const { _hass: hass, _config: cfg, _ent: e } = this;
    if (!hass || !cfg || !e) return;

    // ── Read entity state & attributes ──────────────────────────────────────
    const isActive        = st(hass, e.periodActive) === 'on';
    const phase           = st(hass, e.currentPhase) ?? 'Unknown';
    const cycleDay        = parseInt(st(hass, e.cycleDay))      || null;
    const nextPeriodStr   = st(hass, e.nextPeriod);
    const daysUntil       = att(hass, e.nextPeriod,    'days_until_next_period');  // int >= 1 | null
    const daysOverdue     = att(hass, e.nextPeriod,    'days_overdue');             // -1 | 0 | +N
    const periodLen       = parseInt(st(hass, e.periodLength)) || 5;
    const cycleLen        = parseInt(st(hass, e.cycleLength))  || 28;
    const isFertile       = st(hass, e.fertileWindow) === 'Yes';
    const isPms           = att(hass, e.fertileWindow, 'is_pms_window') === true;
    const daysActive      = att(hass, e.periodActive,  'days_active');              // int | null
    const daysLeft        = att(hass, e.periodActive,  'days_left_of_period');      // int > 0 | null
    const daysEndOverdue  = att(hass, e.periodActive,  'days_period_end_overdue');  // -1 | 0 | +N
    const lastStart       = att(hass, e.periodActive,  'last_period_start');        // ISO | null
    const lastEnd         = att(hass, e.periodActive,  'last_period_end');          // ISO | null
    const symptoms        = att(hass, e.todaysSymptoms,'symptoms') ?? [];

    const meta = PHASE_META[phase] ?? PHASE_META.Unknown;

    // Card title: config override → friendly_name (strip suffix) → fallback
    const title = esc(
      cfg.title ||
      hass.states[e.periodActive]?.attributes?.friendly_name?.replace(/ Period Active$/i, '') ||
      'Cycle Tracker'
    );

    // ── Status subtitle ───────────────────────────────────────────────────────
    let statusLine = '';
    if (isActive) {
      const day  = daysActive ?? '?';
      if (daysLeft != null && daysLeft > 0) {
        statusLine = `Day ${day} · ${pl(daysLeft, 'day')} remaining`;
      } else if (daysEndOverdue != null && daysEndOverdue === 0) {
        statusLine = `Day ${day} · Expected to end today`;
      } else if (daysEndOverdue != null && daysEndOverdue > 0) {
        statusLine = `Day ${day} · ${pl(daysEndOverdue, 'day')} longer than usual`;
      } else {
        statusLine = `Day ${day}`;
      }
    } else {
      if (daysOverdue != null && daysOverdue === 0) {
        statusLine = 'Period due today';
      } else if (daysOverdue != null && daysOverdue > 0) {
        statusLine = `Period ${pl(daysOverdue, 'day')} overdue`;
      } else if (daysUntil != null && daysUntil > 0) {
        statusLine = `Next period in ${pl(daysUntil, 'day')}`;
      }
    }

    // ── Cycle progress bar ────────────────────────────────────────────────────
    let barHtml = '';
    if (cfg.show_cycle_bar !== false && cycleLen > 0) {
      // Phase boundaries (1-indexed days, inclusive)
      const ovDay = Math.max(cycleLen - 14, periodLen + 1);
      const segs  = [
        { phase: 'Menstrual',  start: 1,          end: periodLen      },
        { phase: 'Follicular', start: periodLen+1, end: ovDay-2        },
        { phase: 'Ovulation',  start: ovDay-1,     end: ovDay+2        },
        { phase: 'Luteal',     start: ovDay+3,     end: cycleLen       },
      ].filter(s => s.end >= s.start);

      const segHtml = segs.map((s, i) => {
        const w = ((s.end - s.start + 1) / cycleLen * 100).toFixed(2);
        const r = `${i === 0 ? '4px' : '0'} ${i === segs.length-1 ? '4px' : '0'} ${i === segs.length-1 ? '4px' : '0'} ${i === 0 ? '4px' : '0'}`;
        return `<div style="width:${w}%;background:${PHASE_META[s.phase].color};border-radius:${r};height:100%"
                     title="${s.phase}: days ${s.start}–${s.end}"></div>`;
      }).join('');

      const dotHtml = cycleDay
        ? `<div class="today-dot"
               style="left:${((cycleDay - 0.5) / cycleLen * 100).toFixed(2)}%;
                      border-color:${meta.color}">
             <span class="today-label">day ${cycleDay}</span>
           </div>`
        : '';

      barHtml = `<div class="bar-track clickable" data-entity="${esc(e.cycleDay)}">${segHtml}${dotHtml}</div>`;
    }

    // ── Info rows ─────────────────────────────────────────────────────────────
    const rows = [];

    if (cfg.show_next !== false) {
      let nextLabel = '—';
      if (daysOverdue != null && daysOverdue === 0) {
        nextLabel = 'Due today';
      } else if (daysOverdue != null && daysOverdue > 0) {
        nextLabel = `${pl(daysOverdue, 'day')} overdue`;
        if (nextPeriodStr) nextLabel += ` · was ${nextPeriodStr}`;
      } else if (nextPeriodStr && daysUntil != null && daysUntil > 0) {
        nextLabel = `${nextPeriodStr} · in ${pl(daysUntil, 'day')}`;
      } else if (nextPeriodStr) {
        nextLabel = nextPeriodStr;
      }
      rows.push(infoRow('mdi:calendar-clock', 'Next period', nextLabel,
        (daysOverdue != null && daysOverdue >= 0) ? '#ef5350' : null, e.nextPeriod));
    }

    if (cfg.show_fertile !== false) {
      rows.push(infoRow('mdi:flower-outline', 'Fertile window', isFertile ? 'Yes — ovulation window' : 'No',
        isFertile ? '#66bb6a' : null, e.fertileWindow));
    }

    if (cfg.show_pms !== false) {
      rows.push(infoRow('mdi:emoticon-sad-outline', 'PMS window', isPms ? 'Yes — within 5 days' : 'No',
        isPms ? '#ab47bc' : null, e.fertileWindow));
    }

    if (cfg.show_last !== false && (lastStart || lastEnd)) {
      rows.push(infoRow('mdi:calendar-range', 'Last period', `${fmtDate(lastStart)} → ${fmtDate(lastEnd)}`,
        null, e.periodActive));
    }

    if (cfg.show_stats !== false) {
      rows.push(infoRow('mdi:chart-bar', 'Avg cycle / period', `${cycleLen} days / ${periodLen} days`,
        null, e.cycleLength));
    }

    // ── Symptoms ───────────────────────────────────────────────────────────────
    let sympHtml = '';
    if (cfg.show_symptoms !== false && symptoms.length > 0) {
      const chips = symptoms.map(s => {
        const sev = s.severity ? ` <span class="chip-sev">${esc(s.severity)}</span>` : '';
        return `<span class="chip">${esc(s.symptom)}${sev}</span>`;
      }).join('');
      sympHtml = `
        <div class="section-label clickable" data-entity="${esc(e.todaysSymptoms)}">Today's symptoms</div>
        <div class="chips">${chips}</div>`;
    }

    // ── Log buttons ────────────────────────────────────────────────────────────
    let logHtml = '';
    if (cfg.show_log_buttons !== false) {
      const pendStart = this._pending === 'start';
      const pendEnd   = this._pending === 'end';
      const disabled  = this._pending ? 'disabled' : '';
      const c         = esc(meta.color);

      if (!isActive) {
        logHtml = `
          <button class="log-btn${pendStart ? ' done' : ''}" data-action="start"
                  style="background:${pendStart ? '#4caf50' : c};border-color:${pendStart ? '#4caf50' : c}"
                  ${disabled}>
            ${pendStart ? '✓ Period start logged' : 'Log Period Start'}
          </button>`;
      } else {
        logHtml = `
          <button class="log-btn outline${pendEnd ? ' done' : ''}" data-action="end"
                  style="color:${pendEnd ? '#4caf50' : c};border-color:${pendEnd ? '#4caf50' : c}"
                  ${disabled}>
            ${pendEnd ? '✓ Period end logged' : 'Log Period End'}
          </button>`;
      }

      logHtml = `<div class="log-row">${logHtml}</div>`;
    }



    // ── Full render ────────────────────────────────────────────────────────────
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px 16px 12px; box-sizing: border-box; }

        /* ── Header ── */
        .header { display: flex; align-items: center; gap: 10px; margin-bottom: 2px; }
        .badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 10px; border-radius: 20px; font-size: .75rem; font-weight: 600;
          background: ${esc(meta.bg)}; color: ${esc(meta.color)};
          white-space: nowrap;
        }
        .badge-icon { font-size: .95rem; }
        .card-title {
          flex: 1; font-size: 1.05rem; font-weight: 600;
          color: var(--primary-text-color); overflow: hidden;
          white-space: nowrap; text-overflow: ellipsis;
        }
        .cycle-day-chip {
          font-size: .75rem; color: var(--secondary-text-color);
          white-space: nowrap;
        }

        /* ── Status subtitle ── */
        .status {
          font-size: .85rem; margin: 4px 0 12px;
          color: ${isActive ? esc(meta.color) : 'var(--secondary-text-color)'};
          font-weight: ${isActive ? '500' : '400'};
        }

        /* ── Progress bar ── */
        .bar-track {
          position: relative; display: flex; height: 8px;
          border-radius: 4px; overflow: visible; margin-bottom: 14px;
        }
        .today-dot {
          position: absolute; top: 50%;
          transform: translate(-50%, -50%);
          width: 14px; height: 14px; border-radius: 50%;
          background: var(--card-background-color, white);
          border: 2.5px solid;
          box-shadow: 0 1px 3px rgba(0,0,0,.25);
          z-index: 1;
        }
        .today-label {
          display: none; position: absolute; bottom: 16px; left: 50%;
          transform: translateX(-50%);
          background: var(--card-background-color, white);
          border: 1px solid var(--divider-color);
          border-radius: 4px; padding: 1px 5px;
          font-size: .7rem; white-space: nowrap;
          color: var(--primary-text-color);
          box-shadow: 0 1px 3px rgba(0,0,0,.15);
          pointer-events: none;
        }
        .today-dot:hover .today-label { display: block; }

        /* ── Clickable elements ── */
        .clickable { cursor: pointer; }
        .row.clickable:hover { background: var(--secondary-background-color); border-radius: 6px; }

        /* ── Info rows ── */
        .rows { display: flex; flex-direction: column; gap: 7px; margin-bottom: 10px; }
        .row {
          display: flex; align-items: center; gap: 8px; min-height: 20px;
          padding: 2px 4px; margin: -2px -4px;
          transition: background .15s;
        }
        .row ha-icon { --mdc-icon-size: 16px; color: var(--secondary-text-color); flex-shrink: 0; }
        .row-label { font-size: .82rem; color: var(--secondary-text-color); width: 110px; flex-shrink: 0; }
        .row-value { font-size: .85rem; color: var(--primary-text-color); font-weight: 500; }

        /* ── Symptoms ── */
        .section-label { font-size: .75rem; color: var(--secondary-text-color); margin-bottom: 5px; }
        .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
        .chip {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 10px; border-radius: 12px; font-size: .78rem;
          background: var(--secondary-background-color); color: var(--primary-text-color);
        }
        .chip-sev { opacity: .65; font-size: .72rem; }

        /* ── Log buttons ── */
        .log-row { margin-top: 6px; }
        .log-btn {
          width: 100%; padding: 9px 0; border-radius: 8px; border: 1.5px solid;
          font-size: .88rem; font-weight: 500; cursor: pointer;
          transition: opacity .15s, background .2s, border-color .2s, color .2s;
          background: var(--primary-color); color: white;
        }
        .log-btn.outline { background: transparent; }
        .log-btn.done    { background: #4caf50 !important; border-color: #4caf50 !important; color: white !important; }
        .log-btn:disabled { opacity: .55; cursor: default; }
        .log-btn:not(:disabled):hover { opacity: .85; }

      </style>

      <ha-card>

        <div class="header">
          <div class="badge clickable" data-entity="${esc(e.currentPhase)}">
            <span class="badge-icon">${meta.icon}</span>
            <span>${esc(phase)}</span>
          </div>
          <div class="card-title">${title}</div>
          ${cycleDay ? `<div class="cycle-day-chip clickable" data-entity="${esc(e.cycleDay)}">Day ${cycleDay} of ${cycleLen}</div>` : ''}
        </div>

        ${statusLine ? `<div class="status">${esc(statusLine)}</div>` : '<div style="height:12px"></div>'}

        ${barHtml}

        <div class="rows">${rows.join('')}</div>

        ${sympHtml}

        ${logHtml}

      </ha-card>
    `;
  }

  getCardSize() { return 4; }
}

// ── Visual editor ──────────────────────────────────────────────────────────────

class MenstrualCycleTrackerCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass   = null;
  }

  set hass(hass) {
    this._hass = hass;
    const form = this.shadowRoot.querySelector('ha-form');
    if (form) form.hass = hass;
  }

  setConfig(config) {
    this._config = config;
    this._ensureForm();
    const form = this.shadowRoot.querySelector('ha-form');
    form.data  = this._config;
  }

  _ensureForm() {
    if (this.shadowRoot.querySelector('ha-form')) return;
    const form = document.createElement('ha-form');
    form.schema       = SCHEMA;
    form.computeLabel = s => s.label ?? s.name;
    form.addEventListener('value-changed', e => {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: e.detail.value },
        bubbles: true, composed: true,
      }));
    });
    this.shadowRoot.appendChild(form);
    if (this._hass) form.hass = this._hass;
  }
}

// ── Registration ───────────────────────────────────────────────────────────────

customElements.define('menstrual-cycle-tracker-card', MenstrualCycleTrackerCard);
customElements.define('menstrual-cycle-tracker-card-editor', MenstrualCycleTrackerCardEditor);

window.customCards ??= [];
window.customCards.push({
  type:        'menstrual-cycle-tracker-card',
  name:        'Menstrual Cycle Tracker Card',
  description: 'Shows cycle phase, progress, fertile / PMS windows, symptoms, and log buttons.',
  preview:     false,
});
