/**
 * Compact period outcome with an optional comparison to the previous period.
 */
import { TooltipHelper } from '../../../utils/TooltipHelper.js';

export class StatsScoreRing {
  constructor(context) {
    this.context = context;
    this.plugin = context.plugin;
  }

  render(container, metrics) {
    if (!container || !metrics) return;
    const t = (k, p) => this.plugin.translationManager.t(k, p);

    const section = container.createDiv({ cls: "dh-stats-score-section" });

    const hasScheduled = (metrics.totalScheduled ?? 0) > 0;
    const scoreVal = hasScheduled ? (metrics.consistencyRate ?? 0) : 0;
    const radius = 54;
    const stroke = 7;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (circumference * Math.min(100, scoreVal) / 100);

    // 1. Text Summary (Hero Title, Context, and Delta Badge)
    const summary = section.createDiv({ cls: "dh-score-summary" });
    const isAr = this.context.isAr ? this.context.isAr() : (this.plugin.settings?.language === "ar");
    summary.createDiv({
      cls: "dh-score-hero-label",
      text: t("stats_score_hero_title") || (isAr ? "معدل الإنجاز في الفترة" : "Completion rate for this period"),
    });
    const contextEl = summary.createDiv({
      cls: "dh-score-context",
      text: hasScheduled ? t("stats_score_basis") : t("stats_score_no_schedule"),
    });
    if (hasScheduled) {
      TooltipHelper.set(contextEl, t("stats_score_tooltip"));
    }

    // Delta badge (comparison pill vs prior period)
    if (metrics.delta !== null) {
      const deltaRow = summary.createDiv({ cls: "dh-score-delta-row" });
      const deltaBadge = deltaRow.createSpan({ cls: `dh-score-delta is-${metrics.deltaType}` });
      const prior = scoreVal - metrics.delta;

      let deltaText;
      if (metrics.deltaType === "positive") {
        deltaText = t("stats_delta_up", { diff: metrics.delta, prior });
      } else if (metrics.deltaType === "negative") {
        deltaText = t("stats_delta_down", { diff: Math.abs(metrics.delta), prior });
      } else {
        deltaText = t("stats_delta_neutral", { prior });
      }
      deltaBadge.textContent = deltaText;
    }

    // 2. SVG Ring Gauge
    const ringWrap = section.createDiv({ cls: "dh-score-ring-wrap" });
    TooltipHelper.set(ringWrap, t("stats_score_tooltip"));

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 128 128");
    svg.setAttribute("class", "dh-score-ring-svg");

    // Background track circle
    const bgCircle = document.createElementNS(svgNS, "circle");
    bgCircle.setAttribute("cx", "64");
    bgCircle.setAttribute("cy", "64");
    bgCircle.setAttribute("r", String(radius));
    bgCircle.setAttribute("class", "dh-score-ring-track");
    bgCircle.setAttribute("stroke-width", String(stroke));
    svg.appendChild(bgCircle);

    // Foreground fill circle
    const fgCircle = document.createElementNS(svgNS, "circle");
    fgCircle.setAttribute("cx", "64");
    fgCircle.setAttribute("cy", "64");
    fgCircle.setAttribute("r", String(radius));
    fgCircle.setAttribute("class", `dh-score-ring-fill ${this._getRingColorClass(scoreVal)}`);
    fgCircle.setAttribute("stroke-width", String(stroke + 1));
    fgCircle.setAttribute("stroke-dasharray", String(circumference));
    fgCircle.setAttribute("stroke-dashoffset", String(circumference)); // Start empty for animation
    fgCircle.setAttribute("stroke-linecap", "round");
    svg.appendChild(fgCircle);

    ringWrap.appendChild(svg);

    // Center text overlay (inside the ring)
    const centerText = ringWrap.createDiv({ cls: "dh-score-center-text" });
    centerText.createDiv({ cls: "dh-score-value", text: hasScheduled ? `${scoreVal}%` : "—" });

    // Animate the ring fill after a frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fgCircle.setAttribute("stroke-dashoffset", String(dashOffset));
      });
    });

    return section;
  }

  _getRingColorClass(rate) {
    if (rate >= 80) return "is-excellent";
    if (rate >= 50) return "is-good";
    if (rate >= 25) return "is-fair";
    return "is-low";
  }
}
