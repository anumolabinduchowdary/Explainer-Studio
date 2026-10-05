import { VISUAL_IDS, type VisualId } from "./visuals";

/**
 * The artwork for the illustration library: simple, flat, friendly SVGs drawn
 * on a 240 x 240 grid. They are built from a few small helpers so the people
 * share one consistent style.
 */

const INK = "#2B2118";
const STEEL = "#64748B";
const SLATE = "#475569";

const SKIN = { warm: "#E3A77C", brown: "#C58456", light: "#F1C7A1", deep: "#8D5B3C" };
const HAIR = { black: "#2A1B14", brown: "#4A2C1A" };

const n = (value: number) => Math.round(value * 10) / 10;

type Point = [number, number];

function limb(from: Point, to: Point, color: string, width: number): string {
  return `<path d="M${n(from[0])} ${n(from[1])}L${n(to[0])} ${n(to[1])}" stroke="${color}" stroke-width="${n(width)}" stroke-linecap="round" fill="none"/>`;
}

function heart(cx: number, cy: number, s: number, fill: string): string {
  return `<path d="M${n(cx)} ${n(cy + 0.9 * s)}C${n(cx - 1.7 * s)} ${n(cy - 0.15 * s)} ${n(cx - 0.85 * s)} ${n(cy - 1.35 * s)} ${n(cx)} ${n(cy - 0.45 * s)}C${n(cx + 0.85 * s)} ${n(cy - 1.35 * s)} ${n(cx + 1.7 * s)} ${n(cy - 0.15 * s)} ${n(cx)} ${n(cy + 0.9 * s)}Z" fill="${fill}"/>`;
}

function star(cx: number, cy: number, outer: number, inner: number, fill: string): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outer : inner;
    points.push(`${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))}`);
  }
  return `<polygon points="${points.join(" ")}" fill="${fill}" stroke="${fill}" stroke-width="${n(outer * 0.12)}" stroke-linejoin="round"/>`;
}

function shadow(cx: number, cy: number, rx: number): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="7" fill="${INK}" opacity="0.1"/>`;
}

type HairStyle = "short" | "long" | "pigtails" | "bun";

function head(cx: number, cy: number, r: number, skin: string, hair: string, style: HairStyle = "short"): string {
  const parts: string[] = [];
  if (style === "long") {
    parts.push(
      `<rect x="${n(cx - 1.14 * r)}" y="${n(cy - 0.7 * r)}" width="${n(2.28 * r)}" height="${n(2.05 * r)}" rx="${n(0.95 * r)}" fill="${hair}"/>`,
    );
  }
  if (style === "pigtails") {
    parts.push(
      `<circle cx="${n(cx - 1.08 * r)}" cy="${n(cy + 0.2 * r)}" r="${n(0.4 * r)}" fill="${hair}"/>`,
      `<circle cx="${n(cx + 1.08 * r)}" cy="${n(cy + 0.2 * r)}" r="${n(0.4 * r)}" fill="${hair}"/>`,
    );
  }
  if (style === "bun") {
    parts.push(`<circle cx="${n(cx)}" cy="${n(cy - 1.02 * r)}" r="${n(0.42 * r)}" fill="${hair}"/>`);
  }
  parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${skin}"/>`);
  // Hair: the top of the head down to a soft, curved hairline.
  parts.push(
    `<path d="M${n(cx - r)} ${n(cy - 0.08 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(2 * r)} 0c${n(-0.3 * r)} ${n(-0.45 * r)} ${n(-0.7 * r)} ${n(-0.6 * r)} ${n(-r)} ${n(-0.6 * r)}s${n(-0.7 * r)} ${n(0.15 * r)} ${n(-r)} ${n(0.6 * r)}z" fill="${hair}"/>`,
  );
  const eye = Math.max(1.8, 0.1 * r);
  parts.push(
    `<circle cx="${n(cx - 0.36 * r)}" cy="${n(cy + 0.14 * r)}" r="${n(eye)}" fill="${INK}"/>`,
    `<circle cx="${n(cx + 0.36 * r)}" cy="${n(cy + 0.14 * r)}" r="${n(eye)}" fill="${INK}"/>`,
    `<path d="M${n(cx - 0.3 * r)} ${n(cy + 0.44 * r)}q${n(0.3 * r)} ${n(0.3 * r)} ${n(0.6 * r)} 0" stroke="${INK}" stroke-width="${n(Math.max(1.8, 0.09 * r))}" stroke-linecap="round" fill="none"/>`,
  );
  return parts.join("");
}

type PersonOptions = {
  x: number;
  /** Centre of the head. */
  y: number;
  /** Head radius; the rest of the body scales from it. */
  r: number;
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  hairStyle?: HairStyle;
  torsoH?: number;
  legLen?: number;
  handL?: Point;
  handR?: Point;
  footL?: Point;
  footR?: Point;
};

function person(o: PersonOptions): string {
  const { x, y, r } = o;
  const torsoH = (o.torsoH ?? 2.3) * r;
  const legLen = (o.legLen ?? 1.6) * r;
  const torsoW = 1.7 * r;
  const torsoY = y + 1.15 * r;
  const hipY = torsoY + torsoH - 0.3 * r;
  const footL = o.footL ?? [x - 0.45 * r, hipY + legLen];
  const footR = o.footR ?? [x + 0.45 * r, hipY + legLen];
  const shoulderL: Point = [x - 0.7 * r, torsoY + 0.5 * r];
  const shoulderR: Point = [x + 0.7 * r, torsoY + 0.5 * r];
  const handL = o.handL ?? [x - 1.45 * r, torsoY + 1.7 * r];
  const handR = o.handR ?? [x + 1.45 * r, torsoY + 1.7 * r];
  const along = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const shoe = (foot: Point) =>
    `<ellipse cx="${n(foot[0] + Math.sign(foot[0] - x || 1) * 0.12 * r)}" cy="${n(foot[1] + 0.14 * r)}" rx="${n(0.46 * r)}" ry="${n(0.26 * r)}" fill="${INK}"/>`;

  return [
    limb([x - 0.4 * r, hipY], footL, o.pants, 0.58 * r),
    limb([x + 0.4 * r, hipY], footR, o.pants, 0.58 * r),
    shoe(footL),
    shoe(footR),
    limb(shoulderL, handL, o.skin, 0.42 * r),
    limb(shoulderR, handR, o.skin, 0.42 * r),
    `<rect x="${n(x - torsoW / 2)}" y="${n(torsoY)}" width="${n(torsoW)}" height="${n(torsoH)}" rx="${n(0.6 * r)}" fill="${o.shirt}"/>`,
    limb(shoulderL, along(shoulderL, handL, 0.4), o.shirt, 0.56 * r),
    limb(shoulderR, along(shoulderR, handR, 0.4), o.shirt, 0.56 * r),
    head(x, y, r, o.skin, o.hair, o.hairStyle),
  ].join("");
}

/* ------------------------------------------------------------------ */
/* The illustrations                                                   */
/* ------------------------------------------------------------------ */

const ART: Record<VisualId, string> = {
  brain: [
    `<g transform="translate(0 8)">`,
    `<path d="M120 52c-14-14-40-12-50 4-18 2-30 18-26 36-12 10-14 30-2 42-2 18 12 34 30 34 8 12 30 14 48 4z" fill="#F9A8D4"/>`,
    `<path d="M120 52c14-14 40-12 50 4 18 2 30 18 26 36 12 10 14 30 2 42 2 18-12 34-30 34-8 12-30 14-48 4z" fill="#F472B6"/>`,
    `<path d="M120 60v108" stroke="#BE185D" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M94 82c-10 0-17 8-15 17M66 122c8-7 21-5 25 6M98 158c-6-9-19-9-25 0" stroke="#BE185D" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    `<path d="M146 82c10 0 17 8 15 17M174 122c-8-7-21-5-25 6M142 158c6-9 19-9 25 0" stroke="#9D174D" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    `</g>`,
  ].join(""),

  "child-walking": [
    shadow(122, 204, 46),
    `<path d="M40 136h20M32 158h24" stroke="#CBD5E1" stroke-width="6" stroke-linecap="round"/>`,
    person({
      x: 120,
      y: 64,
      r: 26,
      skin: SKIN.warm,
      hair: HAIR.black,
      shirt: "#14B8A6",
      pants: "#4F46E5",
      footL: [100, 190],
      footR: [146, 186],
      handL: [86, 140],
      handR: [156, 130],
    }),
  ].join(""),

  "child-walker": [
    shadow(120, 208, 68),
    person({
      x: 120,
      y: 62,
      r: 24,
      skin: SKIN.brown,
      hair: HAIR.black,
      hairStyle: "pigtails",
      shirt: "#FBBF24",
      pants: "#0F766E",
      footL: [111, 190],
      footR: [129, 190],
      handL: [68, 124],
      handR: [172, 124],
    }),
    limb([66, 126], [66, 194], STEEL, 7),
    limb([174, 126], [174, 194], STEEL, 7),
    limb([66, 160], [174, 160], STEEL, 7),
    limb([58, 122], [76, 122], INK, 10),
    limb([164, 122], [182, 122], INK, 10),
    `<circle cx="66" cy="200" r="8" fill="${INK}"/><circle cx="66" cy="200" r="3" fill="#CBD5E1"/>`,
    `<circle cx="174" cy="200" r="8" fill="${INK}"/><circle cx="174" cy="200" r="3" fill="#CBD5E1"/>`,
  ].join(""),

  "child-wheelchair": [
    shadow(122, 210, 70),
    limb([80, 92], [86, 150], SLATE, 7),
    limb([80, 92], [66, 88], SLATE, 7),
    limb([86, 150], [150, 150], SLATE, 8),
    `<path d="M150 150L168 184H188" stroke="${SLATE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    limb([146, 152], [150, 190], SLATE, 5),
    `<rect x="92" y="88" width="42" height="62" rx="16" fill="#FB7185"/>`,
    limb([114, 140], [152, 140], "#4F46E5", 17),
    limb([152, 140], [166, 176], "#4F46E5", 15),
    `<ellipse cx="174" cy="182" rx="12" ry="6.5" fill="${INK}"/>`,
    head(114, 60, 25, SKIN.light, HAIR.brown, "bun"),
    limb([118, 108], [134, 136], SKIN.light, 11),
    limb([118, 106], [124, 120], "#FB7185", 14),
    `<circle cx="106" cy="164" r="40" stroke="${INK}" stroke-width="7" fill="none"/>`,
    `<circle cx="106" cy="164" r="31" stroke="#94A3B8" stroke-width="3" fill="none"/>`,
    `<path d="M106 133v62M75 164h62M84 142l44 44M128 142l-44 44" stroke="#94A3B8" stroke-width="2.5"/>`,
    `<circle cx="106" cy="164" r="7" fill="${INK}"/>`,
    `<circle cx="150" cy="198" r="9" fill="${INK}"/><circle cx="150" cy="198" r="3" fill="#CBD5E1"/>`,
  ].join(""),

  friends: [
    shadow(120, 206, 82),
    person({
      x: 82,
      y: 76,
      r: 24,
      skin: SKIN.deep,
      hair: HAIR.black,
      hairStyle: "pigtails",
      shirt: "#FBBF24",
      pants: "#0F766E",
      handL: [44, 92],
      handR: [120, 142],
    }),
    person({
      x: 158,
      y: 76,
      r: 24,
      skin: SKIN.light,
      hair: HAIR.brown,
      shirt: "#818CF8",
      pants: SLATE,
      handL: [120, 142],
    }),
    `<circle cx="120" cy="142" r="6.5" fill="${SKIN.warm}"/>`,
  ].join(""),

  family: [
    shadow(120, 206, 92),
    person({
      x: 64,
      y: 70,
      r: 18,
      skin: SKIN.brown,
      hair: HAIR.black,
      hairStyle: "long",
      shirt: "#FB7185",
      pants: "#7C3AED",
      torsoH: 3,
      legLen: 2.9,
      handR: [96, 152],
    }),
    person({
      x: 176,
      y: 70,
      r: 18,
      skin: SKIN.warm,
      hair: HAIR.black,
      shirt: "#14B8A6",
      pants: SLATE,
      torsoH: 3,
      legLen: 2.9,
      handL: [144, 152],
    }),
    person({
      x: 120,
      y: 126,
      r: 14,
      skin: SKIN.warm,
      hair: HAIR.black,
      shirt: "#FBBF24",
      pants: "#4F46E5",
      handL: [97, 152],
      handR: [143, 152],
    }),
  ].join(""),

  doctor: [
    shadow(120, 208, 52),
    limb([110, 172], [110, 196], "#334155", 15),
    limb([130, 172], [130, 196], "#334155", 15),
    `<ellipse cx="107" cy="200" rx="12" ry="6.5" fill="${INK}"/><ellipse cx="133" cy="200" rx="12" ry="6.5" fill="${INK}"/>`,
    limb([97, 108], [80, 154], "#CBD5E1", 19),
    limb([143, 108], [160, 154], "#CBD5E1", 19),
    limb([97, 108], [80, 154], "#FFFFFF", 14),
    limb([143, 108], [160, 154], "#FFFFFF", 14),
    `<circle cx="79" cy="160" r="8" fill="${SKIN.deep}"/><circle cx="161" cy="160" r="8" fill="${SKIN.deep}"/>`,
    `<rect x="90" y="92" width="60" height="88" rx="20" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="3"/>`,
    `<path d="M106 93l14 28 14-28z" fill="#14B8A6"/>`,
    `<path d="M120 121v58" stroke="#CBD5E1" stroke-width="3" stroke-linecap="round"/>`,
    `<path d="M105 94c-3 30 33 30 30 0" stroke="#334155" stroke-width="4" stroke-linecap="round" fill="none"/>`,
    `<path d="M120 117v20" stroke="#334155" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="120" cy="143" r="7" fill="#94A3B8" stroke="#334155" stroke-width="3"/>`,
    heart(137, 158, 6, "#FB7185"),
    head(120, 60, 25, SKIN.deep, HAIR.black, "bun"),
  ].join(""),

  "therapy-ball": [
    shadow(120, 204, 62),
    `<circle cx="120" cy="126" r="72" fill="#38BDF8"/>`,
    `<path d="M52 150c42 22 94 22 136 0" stroke="#0EA5E9" stroke-width="9" stroke-linecap="round" fill="none"/>`,
    `<path d="M49 116c46 20 96 20 142 0" stroke="#7DD3FC" stroke-width="9" stroke-linecap="round" fill="none"/>`,
    `<path d="M76 96a54 54 0 0 1 40-30" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round" fill="none" opacity="0.75"/>`,
    star(196, 52, 13, 5.5, "#FBBF24"),
    star(40, 66, 9, 4, "#FDE68A"),
  ].join(""),

  "speech-bubble": [
    `<path d="M62 46h92a22 22 0 0 1 22 22v44a22 22 0 0 1-22 22H98l-30 26v-26h-6a22 22 0 0 1-22-22V68a22 22 0 0 1 22-22z" fill="#14B8A6"/>`,
    `<circle cx="84" cy="90" r="8" fill="#FFFFFF"/><circle cx="108" cy="90" r="8" fill="#FFFFFF"/><circle cx="132" cy="90" r="8" fill="#FFFFFF"/>`,
    `<path d="M150 124h36a16 16 0 0 1 16 16v26a16 16 0 0 1-16 16h-4v20l-24-20h-8a16 16 0 0 1-16-16v-26a16 16 0 0 1 16-16z" fill="#FBBF24" stroke="#FFFBF5" stroke-width="5" stroke-linejoin="round"/>`,
    heart(168, 154, 11, "#FFFFFF"),
  ].join(""),

  "picture-tablet": [
    shadow(120, 206, 70),
    `<rect x="38" y="44" width="164" height="150" rx="18" fill="#334155"/>`,
    `<rect x="50" y="56" width="140" height="126" rx="8" fill="#F8FAFC"/>`,
    `<rect x="58" y="64" width="58" height="52" rx="9" fill="#FDE68A"/>`,
    `<rect x="124" y="64" width="58" height="52" rx="9" fill="#A7F3D0"/>`,
    `<rect x="58" y="122" width="58" height="52" rx="9" fill="#BFDBFE"/>`,
    `<rect x="124" y="122" width="58" height="52" rx="9" fill="#FBCFE8"/>`,
    `<circle cx="87" cy="90" r="15" fill="#F59E0B"/><circle cx="82" cy="87" r="2" fill="${INK}"/><circle cx="92" cy="87" r="2" fill="${INK}"/><path d="M81 94q6 5 12 0" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
    `<path d="M141 78h24l-3 24a5 5 0 0 1-5 4h-8a5 5 0 0 1-5-4z" fill="#059669"/><path d="M165 84h5a6 6 0 0 1 0 12h-6" stroke="#059669" stroke-width="4" fill="none"/>`,
    heart(87, 148, 12, "#2563EB"),
    star(153, 148, 14, 6, "#DB2777"),
  ].join(""),

  "helping-hands": [
    heart(120, 92, 44, "#FB7185"),
    `<path d="M44 140c2 34 30 58 72 60v-26c-24-2-40-14-44-36a14 14 0 0 0-28 2z" fill="${SKIN.brown}"/>`,
    `<g transform="translate(240 0) scale(-1 1)"><path d="M44 140c2 34 30 58 72 60v-26c-24-2-40-14-44-36a14 14 0 0 0-28 2z" fill="${SKIN.light}"/></g>`,
    `<path d="M98 64a22 22 0 0 1 16-10" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.6"/>`,
  ].join(""),

  heart: [
    heart(120, 122, 62, "#FB7185"),
    `<path d="M80 96a26 26 0 0 1 22-18" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.6"/>`,
    heart(196, 58, 10, "#FDA4AF"),
    heart(44, 70, 8, "#FDA4AF"),
  ].join(""),

  checklist: [
    shadow(120, 212, 60),
    `<rect x="56" y="46" width="128" height="160" rx="14" fill="#F59E0B"/>`,
    `<rect x="67" y="60" width="106" height="136" rx="8" fill="#FFFDF7"/>`,
    `<rect x="94" y="34" width="52" height="26" rx="9" fill="${SLATE}"/>`,
    ...[92, 128, 164].map(
      (y) =>
        `<rect x="79" y="${y - 12}" width="24" height="24" rx="7" fill="#D1FAE5"/>` +
        `<path d="M84.5 ${y}l5 5 9-10" stroke="#059669" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `<rect x="113" y="${y - 4}" width="48" height="8" rx="4" fill="#CBD5E1"/>`,
    ),
  ].join(""),

  chart: [
    `<path d="M48 50V192H198" stroke="${SLATE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<rect x="66" y="152" width="24" height="34" rx="5" fill="#99F6E4"/>`,
    `<rect x="98" y="128" width="24" height="58" rx="5" fill="#5EEAD4"/>`,
    `<rect x="130" y="102" width="24" height="84" rx="5" fill="#2DD4BF"/>`,
    `<rect x="162" y="76" width="24" height="110" rx="5" fill="#14B8A6"/>`,
    `<path d="M70 126L108 104 142 80 182 46" stroke="#F59E0B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<path d="M164 44l18 2-4 18" stroke="#F59E0B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  ].join(""),

  calendar: [
    shadow(120, 210, 66),
    `<rect x="44" y="56" width="152" height="144" rx="16" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="3"/>`,
    `<path d="M44 72a16 16 0 0 1 16-16h120a16 16 0 0 1 16 16v24H44z" fill="#FB7185"/>`,
    `<rect x="76" y="42" width="11" height="30" rx="5.5" fill="${SLATE}"/><rect x="153" y="42" width="11" height="30" rx="5.5" fill="${SLATE}"/>`,
    ...[0, 1, 2].flatMap((row) =>
      [0, 1, 2, 3].map((col) => {
        const marked = row === 1 && col === 2;
        const x = 60 + col * 32;
        const y = 110 + row * 28;
        return (
          `<rect x="${x}" y="${y}" width="24" height="20" rx="6" fill="${marked ? "#14B8A6" : "#E2E8F0"}"/>` +
          (marked
            ? `<path d="M${x + 6} ${y + 10}l4 4 8-8" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
            : "")
        );
      }),
    ),
  ].join(""),

  globe: [
    `<clipPath id="globe-clip"><circle cx="120" cy="120" r="74"/></clipPath>`,
    `<circle cx="120" cy="120" r="74" fill="#38BDF8"/>`,
    `<g clip-path="url(#globe-clip)" fill="#34D399">`,
    `<path d="M66 76c16-14 40-12 50 2 8 12-2 24-16 26-10 2-12 16-26 14-16-2-22-28-8-42z"/>`,
    `<path d="M134 104c14-8 34-2 40 12 6 16-6 34-22 38-14 4-22-8-20-20 2-12-8-22 2-30z"/>`,
    `<path d="M92 150c10-6 22 0 24 10 2 12-8 24-18 20-10-2-14-22-6-30z"/>`,
    `<path d="M150 50c12-2 24 6 26 16l-20 6c-8-4-12-14-6-22z"/>`,
    `</g>`,
    `<ellipse cx="120" cy="120" rx="30" ry="74" stroke="#FFFFFF" stroke-width="3" fill="none" opacity="0.5"/>`,
    `<path d="M46 120h148" stroke="#FFFFFF" stroke-width="3" opacity="0.5"/>`,
    `<circle cx="120" cy="120" r="74" stroke="#0284C7" stroke-width="5" fill="none"/>`,
  ].join(""),

  school: [
    shadow(120, 206, 84),
    `<path d="M120 54V28" stroke="${SLATE}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M120 28h26l-7 8 7 8h-26z" fill="#14B8A6"/>`,
    `<rect x="52" y="108" width="136" height="90" rx="6" fill="#FDE68A"/>`,
    `<path d="M40 112L120 56l80 56z" fill="#FB7185" stroke="#FB7185" stroke-width="8" stroke-linejoin="round"/>`,
    `<circle cx="120" cy="94" r="13" fill="#FFFFFF" stroke="${SLATE}" stroke-width="3"/>`,
    `<path d="M120 87v7l5 4" stroke="${SLATE}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<path d="M105 198v-36a15 15 0 0 1 30 0v36z" fill="#B45309"/>`,
    `<rect x="66" y="130" width="28" height="28" rx="5" fill="#BFDBFE"/><rect x="146" y="130" width="28" height="28" rx="5" fill="#BFDBFE"/>`,
    `<path d="M80 130v28M66 144h28M160 130v28M146 144h28" stroke="#FFFFFF" stroke-width="3"/>`,
  ].join(""),

  home: [
    shadow(120, 208, 80),
    `<rect x="158" y="56" width="20" height="44" rx="4" fill="#B45309"/>`,
    `<rect x="56" y="114" width="128" height="88" rx="8" fill="#FDE68A"/>`,
    `<path d="M34 120L120 46l86 74z" fill="#FB7185" stroke="#FB7185" stroke-width="8" stroke-linejoin="round"/>`,
    `<rect x="104" y="148" width="32" height="54" rx="7" fill="#0F766E"/>`,
    `<circle cx="128" cy="177" r="3" fill="#FDE68A"/>`,
    `<rect x="66" y="136" width="28" height="28" rx="5" fill="#BFDBFE"/><rect x="146" y="136" width="28" height="28" rx="5" fill="#BFDBFE"/>`,
    heart(120, 131, 8, "#FB7185"),
  ].join(""),

  book: [
    shadow(120, 204, 82),
    `<rect x="36" y="72" width="168" height="120" rx="12" fill="#14B8A6"/>`,
    `<path d="M120 84c-18-12-46-14-72-8v100c26-6 54-4 72 8z" fill="#FFFDF7"/>`,
    `<path d="M120 84c18-12 46-14 72-8v100c-26-6-54-4-72 8z" fill="#FFF3DC"/>`,
    `<path d="M62 102c14-3 30-2 44 4M62 122c14-3 30-2 44 4M62 142c14-3 30-2 44 4" stroke="#CBD5E1" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    `<path d="M178 102c-14-3-30-2-44 4M178 122c-14-3-30-2-44 4M178 142c-14-3-30-2-44 4" stroke="#E7D3B1" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    `<path d="M156 62h16v40l-8-8-8 8z" fill="#FB7185"/>`,
  ].join(""),

  lightbulb: [
    `<path d="M120 22v16M60 48l12 12M180 48l-12 12M30 108h16M194 108h16" stroke="#FBBF24" stroke-width="7" stroke-linecap="round"/>`,
    `<path d="M120 52a52 52 0 0 0-34 91c8 8 12 16 12 25h44c0-9 4-17 12-25a52 52 0 0 0-34-91z" fill="#FDE047"/>`,
    `<path d="M92 86a32 32 0 0 1 22-20" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" fill="none" opacity="0.8"/>`,
    `<path d="M106 140l14-20 14 20" stroke="#F59E0B" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<rect x="97" y="170" width="46" height="14" rx="6" fill="#94A3B8"/>`,
    `<rect x="101" y="186" width="38" height="12" rx="6" fill="${STEEL}"/>`,
    `<rect x="110" y="200" width="20" height="9" rx="4.5" fill="${SLATE}"/>`,
  ].join(""),

  question: [
    `<circle cx="120" cy="120" r="78" fill="#818CF8"/>`,
    `<path d="M94 98a26 26 0 1 1 42 20c-10 8-16 14-16 28" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    `<circle cx="120" cy="174" r="10" fill="#FFFFFF"/>`,
  ].join(""),

  star: [
    star(120, 126, 78, 36, "#FBBF24"),
    `<path d="M92 104l14-22" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" opacity="0.7"/>`,
    star(196, 52, 14, 6, "#FDE68A"),
    star(44, 62, 10, 4.5, "#FDE68A"),
    star(196, 190, 8, 3.5, "#FDE68A"),
  ].join(""),

  sun: [
    `<clipPath id="sun-clip"><rect x="24" y="24" width="192" height="192" rx="28"/></clipPath>`,
    `<g clip-path="url(#sun-clip)">`,
    `<rect x="24" y="24" width="192" height="192" fill="#E0F2FE"/>`,
    ...Array.from({ length: 12 }, (_, i) => {
      const angle = (i * Math.PI) / 6;
      return limb(
        [120 + 58 * Math.cos(angle), 122 + 58 * Math.sin(angle)],
        [120 + 76 * Math.cos(angle), 122 + 76 * Math.sin(angle)],
        "#F59E0B",
        7,
      );
    }),
    `<circle cx="120" cy="122" r="44" fill="#FBBF24"/>`,
    `<path d="M24 196c30-40 70-52 96-52s66 12 96 52v24H24z" fill="#34D399"/>`,
    `<path d="M24 216c40-34 84-38 114-32s58 16 78 32z" fill="#10B981"/>`,
    `</g>`,
  ].join(""),
};

/* ------------------------------------------------------------------ */

const SVG_SIZE = 480; // rendered larger than the 240 grid so it stays crisp on canvas

export function visualSvg(id: VisualId): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 240 240">${ART[id]}</svg>`;
}

const urlCache = new Map<VisualId, string>();

/** A data: URL for an illustration, usable in <img> and on canvas. */
export function visualDataUrl(id: VisualId): string {
  let url = urlCache.get(id);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(visualSvg(id))}`;
    urlCache.set(id, url);
  }
  return url;
}

let imagesPromise: Promise<Map<VisualId, HTMLImageElement>> | null = null;

/** Loads every illustration as an image once, for drawing on canvas. */
export function loadVisualImages(): Promise<Map<VisualId, HTMLImageElement>> {
  imagesPromise ??= Promise.all(
    VISUAL_IDS.map(
      (id) =>
        new Promise<[VisualId, HTMLImageElement | null]>((resolve) => {
          const image = new Image();
          image.onload = () => resolve([id, image]);
          image.onerror = () => resolve([id, null]);
          image.src = visualDataUrl(id);
        }),
    ),
  ).then((entries) => {
    const images = new Map<VisualId, HTMLImageElement>();
    for (const [id, image] of entries) if (image) images.set(id, image);
    return images;
  });
  return imagesPromise;
}
