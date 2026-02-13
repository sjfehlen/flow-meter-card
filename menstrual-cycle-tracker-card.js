(() => {
  'use strict';

  // ── Phase styling ─────────────────────────────────────────────────────────────
  const PHASE_COLORS = {
    Menstrual:  { bg: '#fee2e2', text: '#be123c', dot: '#f43f5e' },
    Follicular: { bg: '#dcfce7', text: '#15803d', dot: '#22c55e' },
    Ovulation:  { bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
    Luteal:     { bg: '#ffedd5', text: '#c2410c', dot: '#f97316' },
    Unknown:    { bg: '#f3f4f6', text: '#6b7280', dot: '#9ca3af' },
  };

  const PHASE_ICONS = {
    Menstrual:  '🩸',
    Follicular: '🌱',
    Ovulation:  '🥚',
    Luteal:     '🌙',
    Unknown:    '—',
  };

  const PHASE_BAR_COLORS = {
    Menstrual:  '#f43f5e',
    Follicular: '#22c55e',
    Ovulation:  '#3b82f6',
    Luteal:     '#f97316',
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function entityBase(entityId) {
    return entityId.replace(/^binary_sensor\./, '').replace(/_period_active$/, '');
  }

  function deriveEntities(entityId) {
    const base = entityBase(entityId);
    return {
      periodActive:   entityId,
      currentPhase:   `sensor.${base}_current_phase`,
      cycleDay:       `sensor.${base}_cycle_day`,
      nextPeriod:     `sensor.${base}_next_period`,
      periodLength:   `sensor.${base}_period_length`,
      cycleLength:    `sensor.${base}_cycle_length`,
      fertileWindow:  `sensor.${base}_fertile_window`,
      todaysSymptoms: `sensor.${base}_todays_symptoms`,
    };
  }

  function stateVal(hass, entityId) {
    return hass.states[entityId]?.state ?? null;
  }

  function attrVal(hass, entityId, attr) {
    return hass.states[entityId]?.attributes?.[attr] ?? null;
  }

  function phaseSegments(cycleLen, periodLen) {
    const ovulationDay = cycleLen - 14;
    const ovStart = Math.max(periodLen + 1, ovulationDay - 1);
    const ovEnd   = ovulationDay + 2;
    const lutStart = ovEnd + 1;
    return [
      { phase: 'Menstrual',  start: 1,             end: periodLen      },
      { phase: 'Follicular', start: periodLen + 1, end: ovStart - 1    },
      { phase: 'Ovulation',  start: ovStart,        end: ovEnd          },
      { phase: 'Luteal',     start: lutStart,       end: cycleLen       },
    ].filter(s => s.end >= s.start);
  }

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Card ──────────────────────────────────────────────────────────────────────
  class MenstrualCycleTrackerCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }

    static getConfigElement() {
      return document.createElement('menstrual-cycle-tracker-card-editor');
    }

    static getStubConfig() {
      return {
        entity: '',
        title: '',
        name_subject: 'You',
        name_possessive: 'Your',
        show_cycle_bar: true,
        show_fertile_window: true,
        show_pms_window: true,
        show_stats: true,
      };
    }

    setConfig(config) {
      if (!config.entity) throw new Error('Please select a Cycle Tracker entity.');
      this._config   = { ...MenstrualCycleTrackerCard.getStubConfig(), ...config };
      this._entities = deriveEntities(this._config.entity);
    }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    _render() {
      const hass   = this._hass;
      const config = this._config;
      const ent    = this._entities;
      if (!hass || !config) return;

      // ── State ──────────────────────────────────────────────────────────────
      const isActive       = stateVal(hass, ent.periodActive) === 'on';
      const phase          = stateVal(hass, ent.currentPhase) ?? 'Unknown';
      const cycleDay       = parseInt(stateVal(hass, ent.cycleDay)) || null;
      const nextPeriod     = stateVal(hass, ent.nextPeriod);
      const daysUntil      = attrVal(hass, ent.nextPeriod, 'days_until_next_period');
      const daysOverdue    = attrVal(hass, ent.nextPeriod, 'days_overdue');
      const periodLen      = parseInt(stateVal(hass, ent.periodLength)) || 5;
      const cycleLen       = parseInt(stateVal(hass, ent.cycleLength)) || 28;
      const fertileWindow  = stateVal(hass, ent.fertileWindow);
      const isPmsWindow    = attrVal(hass, ent.fertileWindow, 'is_pms_window');
      const daysActive     = attrVal(hass, ent.periodActive, 'days_active');
      const daysLeft       = attrVal(hass, ent.periodActive, 'days_left_of_period');
      const daysEndOverdue = attrVal(hass, ent.periodActive, 'days_period_end_overdue');
      const symptoms       = attrVal(hass, ent.todaysSymptoms, 'symptoms') || [];
      const symptomCount   = symptoms.length;

      const pc    = PHASE_COLORS[phase] ?? PHASE_COLORS.Unknown;
      const icon  = PHASE_ICONS[phase]  ?? '—';
      const title = esc(
        config.title ||
        hass.states[ent.periodActive]?.attributes?.friendly_name?.replace(' Period Active', '') ||
        'Cycle Tracker'
      );

      // ── Status detail line ─────────────────────────────────────────────────
      let statusDetail = '';
      if (isActive) {
        const parts = [];
        if (daysActive)  parts.push(`Day ${daysActive}`);
        if (daysLeft > 0) {
          parts.push(`${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`);
        } else if (daysEndOverdue >= 0) {
          parts.push(daysEndOverdue === 0
            ? 'Expected to end today'
            : `${daysEndOverdue} day${daysEndOverdue !== 1 ? 's' : ''} longer than usual`);
        }
        statusDetail = parts.join(' · ');
      } else if (daysOverdue !== null && daysOverdue >= 0) {
        statusDetail = daysOverdue === 0
          ? 'Expected to start today'
          : `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} late`;
      } else if (daysUntil !== null) {
        statusDetail = daysUntil === 1
          ? 'Due tomorrow'
          : `In ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;
      }

      // ── Cycle bar ──────────────────────────────────────────────────────────
      let cycleBarHtml = '';
      if (config.show_cycle_bar && cycleDay && cycleLen > 1) {
        const segs   = phaseSegments(cycleLen, periodLen);
        const segBars = segs.map(s => {
          const w = ((s.end - s.start + 1) / cycleLen) * 100;
          return `<div class="seg" style="width:${w.toFixed(2)}%;background:${PHASE_BAR_COLORS[s.phase]}"></div>`;
        }).join('');
        const dotPct = ((cycleDay - 1) / (cycleLen - 1)) * 100;
        const phaseLabels = segs.map(s => {
          const w = ((s.end - s.start + 1) / cycleLen) * 100;
          return `<div class="phase-label" style="width:${w.toFixed(2)}%;color:${PHASE_BAR_COLORS[s.phase]}">${s.phase}</div>`;
        }).join('');

        cycleBarHtml = `
          <div class="section">
            <div class="cycle-bar-label">
              <span>Day ${cycleDay} of ${cycleLen}</span>
              <span>${esc(phase)}</span>
            </div>
            <div class="cycle-bar-track">
              ${segBars}
              <div class="cycle-dot" style="left:${dotPct.toFixed(2)}%"></div>
            </div>
            <div class="phase-labels">${phaseLabels}</div>
          </div>`;
      }

      // ── Next period (when inactive) ────────────────────────────────────────
      let nextPeriodHtml = '';
      if (!isActive && nextPeriod) {
        nextPeriodHtml = `
          <div class="info-row">
            <span class="info-label">Next period</span>
            <span class="info-value">${esc(nextPeriod)}</span>
          </div>`;
      }

      // ── Fertile window ────────────────────────────────────────────────────
      let fertileHtml = '';
      if (config.show_fertile_window && fertileWindow !== null) {
        const on = fertileWindow === 'Yes';
        fertileHtml = `
          <div class="info-row">
            <span class="info-label">🥚 Fertile window</span>
            <span class="info-value${on ? ' on' : ''}">${on ? 'Active' : 'No'}</span>
          </div>`;
      }

      // ── PMS window ────────────────────────────────────────────────────────
      let pmsHtml = '';
      if (config.show_pms_window && isPmsWindow !== null) {
        const on = !!isPmsWindow;
        pmsHtml = `
          <div class="info-row">
            <span class="info-label">🌙 PMS window</span>
            <span class="info-value${on ? ' on' : ''}">${on ? 'Active' : 'No'}</span>
          </div>`;
      }

      // ── Stats ─────────────────────────────────────────────────────────────
      let statsHtml = '';
      if (config.show_stats) {
        const symptomChip = symptomCount > 0
          ? `<div class="stat"><div class="stat-val">${symptomCount}</div><div class="stat-label">Today's symptoms</div></div>`
          : '';
        statsHtml = `
          <div class="stats-row">
            <div class="stat"><div class="stat-val">${cycleLen}</div><div class="stat-label">Avg cycle (days)</div></div>
            <div class="stat"><div class="stat-val">${periodLen}</div><div class="stat-label">Avg period (days)</div></div>
            ${symptomChip}
          </div>`;
      }

      // ── Symptom chips ─────────────────────────────────────────────────────
      let symptomsHtml = '';
      if (symptoms.length > 0) {
        const chips = symptoms.map(s =>
          `<span class="symptom-chip">${esc(s.symptom)}${s.severity ? ` <em>${esc(s.severity)}</em>` : ''}</span>`
        ).join('');
        symptomsHtml = `<div class="symptoms-row">${chips}</div>`;
      }

      // ── Render ────────────────────────────────────────────────────────────
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          ha-card { overflow: hidden; font-family: var(--primary-font-family, sans-serif); }

          .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 16px 6px;
          }
          .card-title {
            font-size: 1rem;
            font-weight: 600;
            color: var(--primary-text-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .phase-badge {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 0.72rem;
            font-weight: 700;
            padding: 3px 10px;
            border-radius: 99px;
            background: ${pc.bg};
            color: ${pc.text};
            white-space: nowrap;
            flex-shrink: 0;
            margin-left: 8px;
          }

          .card-content { padding: 6px 16px 14px; }

          /* ── Status row ── */
          .status-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 0;
            border-bottom: 1px solid var(--divider-color, rgba(0,0,0,.12));
            margin-bottom: 8px;
          }
          .status-dot {
            width: 12px; height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
            background: ${isActive ? pc.dot : 'var(--disabled-text-color, #9ca3af)'};
            box-shadow: ${isActive ? `0 0 0 4px ${pc.bg}` : 'none'};
          }
          .status-text { flex: 1; min-width: 0; }
          .status-label { font-size: 0.9rem; font-weight: 600; color: var(--primary-text-color); }
          .status-detail { font-size: 0.75rem; color: var(--secondary-text-color); margin-top: 2px; }

          /* ── Cycle bar ── */
          .section { margin: 10px 0 6px; }
          .cycle-bar-label {
            display: flex;
            justify-content: space-between;
            font-size: 0.72rem;
            color: var(--secondary-text-color);
            margin-bottom: 6px;
          }
          .cycle-bar-track {
            position: relative;
            display: flex;
            height: 8px;
            border-radius: 4px;
            gap: 2px;
            overflow: visible;
          }
          .seg { border-radius: 4px; min-width: 4px; opacity: 0.75; }
          .cycle-dot {
            position: absolute;
            top: 50%; transform: translate(-50%, -50%);
            width: 14px; height: 14px;
            border-radius: 50%;
            background: var(--primary-text-color);
            border: 2px solid var(--ha-card-background, var(--card-background-color, #fff));
            box-shadow: 0 1px 4px rgba(0,0,0,.3);
            pointer-events: none;
          }
          .phase-labels {
            display: flex;
            margin-top: 4px;
            gap: 2px;
          }
          .phase-label {
            font-size: 0.6rem;
            font-weight: 700;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
          }

          /* ── Info rows ── */
          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 0;
            font-size: 0.85rem;
          }
          .info-label { color: var(--secondary-text-color); }
          .info-value { font-weight: 500; color: var(--primary-text-color); }
          .info-value.on { color: ${pc.dot}; font-weight: 700; }

          /* ── Stats ── */
          .stats-row {
            display: flex;
            gap: 8px;
            padding-top: 10px;
            margin-top: 8px;
            border-top: 1px solid var(--divider-color, rgba(0,0,0,.12));
          }
          .stat { text-align: center; flex: 1; }
          .stat-val { font-size: 1.15rem; font-weight: 700; color: var(--primary-text-color); }
          .stat-label { font-size: 0.62rem; color: var(--secondary-text-color); margin-top: 2px; line-height: 1.3; }

          /* ── Symptom chips ── */
          .symptoms-row {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            padding: 8px 0 2px;
          }
          .symptom-chip {
            font-size: 0.7rem;
            padding: 2px 8px;
            border-radius: 99px;
            background: var(--secondary-background-color, rgba(0,0,0,.06));
            color: var(--secondary-text-color);
          }
          .symptom-chip em { font-style: normal; opacity: 0.7; }
        </style>

        <ha-card>
          <div class="card-header">
            <div class="card-title">${title}</div>
            <div class="phase-badge">${icon} ${esc(phase)}</div>
          </div>
          <div class="card-content">

            <div class="status-row">
              <div class="status-dot"></div>
              <div class="status-text">
                <div class="status-label">${isActive ? 'Period Active' : 'No Period'}</div>
                ${statusDetail ? `<div class="status-detail">${esc(statusDetail)}</div>` : ''}
              </div>
            </div>

            ${cycleBarHtml}
            ${nextPeriodHtml}
            ${fertileHtml}
            ${pmsHtml}
            ${symptomsHtml}
            ${statsHtml}

          </div>
        </ha-card>`;
    }

    getCardSize() { return 3; }
  }

  // ── Visual editor ─────────────────────────────────────────────────────────────
  const SCHEMA = [
    {
      name: 'entity',
      required: true,
      label: 'Cycle Tracker (Period Active sensor)',
      selector: { entity: { domain: 'binary_sensor', integration: 'menstrual_cycle_tracker' } },
    },
    { name: 'title',             label: 'Card title (leave blank to use tracker name)',  selector: { text: {} } },
    { name: 'name_subject',      label: 'Subject pronoun (e.g. "You", "She", "They")',   selector: { text: {} } },
    { name: 'name_possessive',   label: 'Possessive (e.g. "Your", "Her", "Their")',      selector: { text: {} } },
    { name: 'show_cycle_bar',    label: 'Show cycle progress bar',                       selector: { boolean: {} } },
    { name: 'show_fertile_window', label: 'Show fertile window row',                     selector: { boolean: {} } },
    { name: 'show_pms_window',   label: 'Show PMS window row',                           selector: { boolean: {} } },
    { name: 'show_stats',        label: 'Show avg cycle / period stats',                 selector: { boolean: {} } },
  ];

  class MenstrualCycleTrackerCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }

    set hass(hass) {
      this._hass = hass;
      const form = this.shadowRoot.querySelector('ha-form');
      if (form) form.hass = hass;
    }

    setConfig(config) {
      this._config = config;
      this._renderEditor();
    }

    _renderEditor() {
      if (!this.shadowRoot.querySelector('ha-form')) {
        const form = document.createElement('ha-form');
        form.addEventListener('value-changed', e => {
          this._config = e.detail.value;
          this.dispatchEvent(new CustomEvent('config-changed', {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          }));
        });
        this.shadowRoot.innerHTML = '<style>:host{display:block;padding:8px 0}</style>';
        this.shadowRoot.appendChild(form);
      }
      const form = this.shadowRoot.querySelector('ha-form');
      form.hass   = this._hass;
      form.data   = this._config;
      form.schema = SCHEMA;
      form.computeLabel = s => s.label ?? s.name;
    }
  }

  customElements.define('menstrual-cycle-tracker-card', MenstrualCycleTrackerCard);
  customElements.define('menstrual-cycle-tracker-card-editor', MenstrualCycleTrackerCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'menstrual-cycle-tracker-card',
    name: 'Menstrual Cycle Tracker Card',
    description: 'Displays cycle data from the Menstrual Cycle Tracker integration.',
    preview: false,
    documentationURL: 'https://github.com/sjfehlen/flow-meter-card',
  });
})();
