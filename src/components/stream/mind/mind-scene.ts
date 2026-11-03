/**
 * The Mind map's WebGL scene: a calm, slowly breathing neural network.
 *
 * Imperative on purpose. React owns the data and the controls around the
 * canvas; this class owns one renderer and one animation loop, and is only
 * ever loaded with a dynamic `import()`, so three.js never lands in the
 * dashboard's first bundle.
 *
 * What is drawn, back to front:
 *   - a faint field of drifting dust, for depth;
 *   - the cortex: a few thousand motes on the surface of a stylised brain
 *     (two hemispheres, a fissure between them, temporal lobes, a
 *     cerebellum), lit by a slow wave of activity that sweeps through it and
 *     the odd spark, so the whole page reads as *your* brain at work;
 *   - connections as curved "dendrites" that occasionally carry a soft signal
 *     travelling outward, the way a thought fires along a pathway;
 *   - nodes as glowing points that breathe at a resting rate (about six
 *     seconds a breath), sized by importance;
 *   - a warm aura with slow ripples around the moment, the one thing at the
 *     centre.
 *
 * Restraint is the design. Nothing flashes, nothing moves fast, and with
 * `prefers-reduced-motion` nothing moves at all unless the user moves it.
 *
 * Input is deliberately small: drag turns the brain (with inertia), tap or
 * hover picks a node. The map fills the screen, so there is no page to
 * scroll: the wheel and a pinch step between the three scales (Moment /
 * Today / Life) through `onZoomStep`, and React decides what that means and
 * passes the result back through `setView`. Free zoom would only let people
 * get lost.
 */

import * as THREE from "three";
import type { MindGraph, MindNode } from "@/lib/stream/mind";

export type MindView = "moment" | "today" | "life";
export type MindTheme = "dark" | "light";

export interface MindSceneOptions {
  container: HTMLElement;
  theme: MindTheme;
  reducedMotion: boolean;
  onHover?: (key: string | null) => void;
  /** A tap on a node gives its key; a tap on empty space gives null. */
  onSelect?: (key: string | null) => void;
  /** First drag or tap: the UI can retire its hint. */
  onInteract?: () => void;
  /** WebGL went away (context lost). The UI should fall back. */
  onError?: (error: Error) => void;
  /** Wheel or pinch: +1 asks for a wider view, -1 for a closer one. */
  onZoomStep?: (direction: 1 | -1) => void;
}

/** How much of each ring stays visible in each view: moment, today, life, hubs. */
const RING_FADE: Record<MindView, [number, number, number, number]> = {
  moment: [1, 0.55, 0.12, 0.12],
  today: [1, 1, 0.42, 0.5],
  life: [1, 1, 1, 1],
};

/** The radius (world units) each view must fit on screen. */
const VIEW_FIT: Record<MindView, number> = {
  moment: 1.5,
  today: 3.3,
  life: 5.3,
};

/** How present the cortex is in each view: a backdrop up close, the whole brain from afar. */
const CORTEX_FADE: Record<MindView, number> = {
  moment: 0.35,
  today: 0.7,
  life: 1,
};

const RING_CODE: Record<MindNode["ring"], number> = {
  moment: 0,
  today: 1,
  life: 2,
  hub: 3,
};

const EDGE_SEGMENTS = 18;
const TRANSITION_MS = 1100;
const DUST_COUNT = 320;
/** Cortex motes: fewer on a phone, where the screen is small and the GPU weaker. */
const CORTEX_COUNT_SMALL = 1700;
const CORTEX_COUNT_LARGE = 3200;
/** Half-extents of the cortex: wide, tall and deep, in world units. */
const CORTEX_EXTENT: [number, number, number] = [5.9, 4.4, 6.6];

/* ------------------------------------------------------------------------ */
/* Shaders                                                                   */
/* ------------------------------------------------------------------------ */

const NODE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  attribute float aRing;
  attribute float aIndex;

  uniform float uTime;
  uniform float uScale;
  uniform float uMaxSize;
  uniform float uMotion;
  uniform float uHover;
  uniform float uSelected;
  uniform vec4 uRingFade;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSelected;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    // A resting breath: about six seconds, each node a little out of step.
    float breathe = 1.0 + uMotion * 0.07 * sin(uTime * 1.05 + aPhase);

    float isHover = 1.0 - step(0.5, abs(aIndex - uHover));
    float isSel = 1.0 - step(0.5, abs(aIndex - uSelected));
    float boost = 1.0 + 0.3 * isHover + 0.2 * isSel;

    gl_PointSize = min(uMaxSize, aSize * uScale * breathe * boost / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;

    float fade = aRing < 0.5 ? uRingFade.x
      : aRing < 1.5 ? uRingFade.y
      : aRing < 2.5 ? uRingFade.z
      : uRingFade.w;

    // Far nodes recede a little, which is most of what reads as depth.
    float depth = clamp(1.25 - (-mv.z) / 26.0, 0.45, 1.0);

    vAlpha = max(fade * depth, max(isHover, isSel));
    vColor = aColor;
    vSelected = isSel;
  }
`;

const NODE_FRAGMENT = /* glsl */ `
  uniform float uLight;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSelected;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;

    float core = smoothstep(0.3, 0.04, d);
    float halo = pow(1.0 - d, 1.9) * 0.55;
    float ring = vSelected * smoothstep(0.05, 0.0, abs(d - 0.66)) * 0.85;

    // On a dark ground the core burns white-hot; on a light one it stays
    // its own colour, a little deeper, like ink in water.
    vec3 dark = mix(vColor, vec3(1.0), core * 0.55);
    vec3 light = vColor * mix(0.78, 0.62, core);
    vec3 color = mix(dark, light, uLight);

    float alpha = (core + halo + ring) * vAlpha;
    gl_FragColor = vec4(color, alpha);
  }
`;

const EDGE_VERTEX = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  attribute float aStrength;
  attribute vec3 aColor;
  attribute float aRing;
  attribute vec2 aEnds;

  uniform float uHover;
  uniform float uSelected;
  uniform vec4 uRingFade;

  varying float vT;
  varying float vSeed;
  varying float vStrength;
  varying vec3 vColor;
  varying float vFade;
  varying float vActive;

  float touches(float index) {
    return max(
      1.0 - step(0.5, abs(aEnds.x - index)),
      1.0 - step(0.5, abs(aEnds.y - index))
    );
  }

  void main() {
    vT = aT;
    vSeed = aSeed;
    vStrength = aStrength;
    vColor = aColor;
    vFade = aRing < 0.5 ? uRingFade.x
      : aRing < 1.5 ? uRingFade.y
      : aRing < 2.5 ? uRingFade.z
      : uRingFade.w;
    vActive = max(touches(uHover), touches(uSelected));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EDGE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uLight;

  varying float vT;
  varying float vSeed;
  varying float vStrength;
  varying vec3 vColor;
  varying float vFade;
  varying float vActive;

  void main() {
    // Thin at the ends, fuller in the middle, like a fibre.
    float body = 0.55 + 0.45 * sin(vT * 3.14159);
    float base = vStrength * 0.42 * body;

    // Each pathway fires now and then: every 7-16 s, a soft pulse runs from
    // one end to the other over about 1.8 s. Most are quiet at any instant.
    float period = 7.0 + vSeed * 9.0;
    float cycle = mod(uTime + vSeed * 37.0, period);
    float head = cycle / 1.8;
    float pulse = head < 1.25 ? exp(-pow((vT - head) * 6.5, 2.0)) : 0.0;
    pulse *= uMotion;

    float alpha = (base + pulse * 0.75 + vActive * 0.5) * max(vFade, vActive);
    vec3 glow = mix(vColor, vec3(1.0), pulse * 0.45 * (1.0 - uLight));
    vec3 color = mix(glow, vColor * 0.7, uLight);
    gl_FragColor = vec4(color, alpha * mix(1.0, 0.85, uLight));
  }
`;

const DUST_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uMotion;
  uniform float uScale;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float t = uTime * 0.05 * uMotion;
    p.x += sin(t + aSeed * 6.28) * 0.35;
    p.y += cos(t * 0.8 + aSeed * 12.0) * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.04 + aSeed * 0.05) * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = 0.18 + 0.22 * aSeed;
  }
`;

const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(uColor, (1.0 - d) * vAlpha);
  }
`;

const CORTEX_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aShell;

  uniform float uTime;
  uniform float uMotion;
  uniform float uScale;
  uniform float uFade;
  uniform float uMaxSize;

  varying float vAlpha;
  varying float vSpark;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float depth = -mv.z;

    // One slow wave of activity sweeps through the brain about every nine
    // seconds, from a direction that itself turns slowly.
    float a = uTime * 0.05;
    vec3 dir = normalize(vec3(sin(a), 0.35, cos(a)));
    float along = dot(normalize(position), dir);
    float front = mod(uTime * 0.11 + 0.4, 1.0) * 2.8 - 1.4;
    float wave = exp(-pow((along - front) * 4.5, 2.0)) * uMotion;

    // Now and then a mote sparks: about one in sixty at any moment, each for
    // a couple of seconds, rising and falling smoothly.
    float cycle = uTime * 0.45 + aSeed * 7.0;
    float slot = floor(cycle);
    float lucky = step(0.984, fract(sin(slot * 12.9898 + aSeed * 78.233) * 43758.5453));
    float spark = lucky * sin(fract(cycle) * 3.14159) * uMotion;

    float twinkle = 0.75 + 0.25 * sin(uTime * (0.5 + aSeed * 1.3) + aSeed * 40.0) * uMotion;
    float size = (0.045 + aSeed * 0.04) * (1.0 + wave * 0.7 + spark * 1.6);
    gl_PointSize = min(uMaxSize * 0.35, size * uScale / max(0.1, depth));
    gl_Position = projectionMatrix * mv;

    // Motes right in front of the camera (the Moment view sits inside the
    // brain) melt away instead of filling the screen.
    float near = smoothstep(1.2, 3.5, depth);
    float far = clamp(1.3 - depth / 30.0, 0.35, 1.0);
    float base = mix(0.12, 0.42, aShell) * twinkle;
    vAlpha = (base + wave * 0.32 + spark * 0.65) * uFade * near * far;
    vSpark = spark;
  }
`;

const CORTEX_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSparkColor;
  uniform float uLight;
  varying float vAlpha;
  varying float vSpark;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 1.6);
    vec3 color = mix(uColor, uSparkColor, clamp(vSpark, 0.0, 1.0));
    gl_FragColor = vec4(color, soft * vAlpha * mix(1.0, 0.75, uLight));
  }
`;

const AURA_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURA_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uLight;
  uniform float uOpacity;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;

    float glow = pow(1.0 - d, 3.0) * 0.55;

    // Two slow ripples leave the centre, a breath apart.
    float ripples = 0.0;
    for (int i = 0; i < 2; i++) {
      float phase = fract(uTime / 7.0 + float(i) * 0.5);
      float r = 0.2 + phase * 0.8;
      ripples += smoothstep(0.035, 0.0, abs(d - r)) * (1.0 - phase) * 0.22;
    }
    ripples *= uMotion;

    float alpha = (glow + ripples) * uOpacity * mix(1.0, 0.7, uLight);
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

type Vec3 = [number, number, number];

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** World size of a node's point: the moment is drawn largest. */
function nodeSize(node: MindNode): number {
  if (node.ring === "moment") return 1.25;
  if (node.ring === "hub") return 0.62 + node.weight * 0.22;
  if (node.ring === "today") return 0.6 + node.weight * 0.4;
  return 0.36 + node.weight * 0.34;
}

function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Points on (and a few inside) a stylised brain, deterministic so it is the
 * same brain on every visit. Returns positions plus, per point, a seed and
 * whether it sits on the surface (1) or inside (0).
 *
 * Shape, in order: an ovoid; a flatter underside; a narrower front; temporal
 * lobes bulging low on each side; a fissure down the top midline that parts
 * the two hemispheres; gentle folds; and a cerebellum tucked under the back.
 */
function makeCortexPoints(count: number): {
  positions: Float32Array;
  seeds: Float32Array;
  shells: Float32Array;
} {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const shells = new Float32Array(count);
  let s = 987654321;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const [ax, ay, az] = CORTEX_EXTENT;
  const cerebellum = Math.round(count * 0.1);

  for (let i = 0; i < count; i++) {
    // A uniform direction on the sphere.
    const uy0 = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const k = Math.sqrt(1 - uy0 * uy0);
    const ux = Math.cos(theta) * k;
    const uy = uy0;
    const uz = Math.sin(theta) * k;

    const surface = rand() < 0.86;
    const depth = surface ? 0.95 + rand() * 0.06 : 0.35 + rand() * 0.5;
    let x: number, y: number, z: number;

    if (i < cerebellum) {
      // Cerebellum: a small, finely folded body under the back of the brain.
      const fold = 1 + 0.06 * Math.sin(uy * 22);
      x = ux * 2.5 * depth * fold;
      y = -2.7 + uy * 1.15 * depth * fold;
      z = -4.3 + uz * 1.6 * depth;
    } else {
      // Folds: a little radial ripple, like gyri seen from far away.
      const folds =
        1 +
        0.035 * Math.sin(7.3 * ux + 1.1) * Math.sin(6.1 * uy + 0.3) * Math.sin(6.7 * uz + 2.0) +
        0.02 * Math.sin(13 * ux + 11 * uz);
      x = ux * ax * depth * folds;
      y = uy * ay * depth * folds;
      z = uz * az * depth * folds;

      if (uy < 0) y *= 0.72; // flatter underneath
      x *= 1 - 0.12 * Math.max(0, uz); // narrower at the front
      // Temporal lobes, low on each side and a little forward.
      x *= 1 + 0.1 * Math.exp(-(((uy + 0.38) / 0.24) ** 2)) * Math.exp(-(((uz - 0.12) / 0.5) ** 2));
      // The longitudinal fissure: the top midline dips and the halves part.
      if (uy > -0.15) {
        const groove = Math.exp(-((ux / 0.11) ** 2));
        y -= groove * 0.9 * Math.max(0, uy + 0.15);
        x += Math.sign(ux || 1) * 0.16;
      }
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds[i] = rand();
    shells[i] = surface ? 1 : 0;
  }
  return { positions, seeds, shells };
}

/* ------------------------------------------------------------------------ */
/* Scene                                                                     */
/* ------------------------------------------------------------------------ */

export class MindScene {
  private readonly container: HTMLElement;
  private readonly options: MindSceneOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly world = new THREE.Group();
  private readonly startedAt = performance.now();
  private lastFrameAt = performance.now();

  private readonly nodeMaterial: THREE.ShaderMaterial;
  private readonly edgeMaterial: THREE.ShaderMaterial;
  private readonly dustMaterial: THREE.ShaderMaterial;
  private readonly auraMaterial: THREE.ShaderMaterial;
  private readonly cortexMaterial: THREE.ShaderMaterial;

  private nodePoints: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private readonly dust: THREE.Points;
  private readonly aura: THREE.Mesh;
  private readonly cortex: THREE.Points;
  private cortexFade = CORTEX_FADE.today;
  private cortexFadeTarget = CORTEX_FADE.today;
  /** Screen space covered by overlays: the brain centres in what is left. */
  private insets = { top: 0, bottom: 0 };
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart: number | null = null;
  private wheelAccum = 0;
  private lastZoomStepAt = 0;

  private graph: MindGraph | null = null;
  private nodes: MindNode[] = [];
  private indexByKey = new Map<string, number>();
  /** Where each node is drawn right now, so a new graph can glide from it. */
  private current = new Map<string, Vec3>();
  private from: Vec3[] = [];
  private to: Vec3[] = [];
  private sizeFrom: number[] = [];
  private sizeTo: number[] = [];
  private transitionStart = -1;

  private view: MindView = "today";
  private ringFade = new THREE.Vector4(...RING_FADE.today);
  private ringFadeTarget = new THREE.Vector4(...RING_FADE.today);
  private selectedKey: string | null = null;
  private hoverKey: string | null = null;

  private readonly target = new THREE.Vector3();
  private distance = 9;
  private distanceTarget = 9;

  // Rotation: yaw/pitch of the world, with drag inertia.
  private yaw = 0.35;
  private pitch = 0.12;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private dragging = false;
  private lastPointer = { x: 0, y: 0, t: 0 };
  private downPointer = { x: 0, y: 0, t: 0 };
  private lastInteraction = -Infinity;

  private theme: MindTheme;
  private reducedMotion: boolean;
  private width = 1;
  private height = 1;
  private frame = 0;
  private running = false;
  private visible = true;
  private disposed = false;
  private needsRender = true;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly scratch = new THREE.Vector3();

  constructor(options: MindSceneOptions) {
    this.options = options;
    this.container = options.container;
    this.theme = options.theme;
    this.reducedMotion = options.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // The map is the whole page, so there is no page scroll to protect: every
    // touch belongs to the brain (drag to turn, pinch to change scale).
    canvas.style.touchAction = "none";
    canvas.setAttribute("aria-hidden", "true");
    this.container.appendChild(canvas);

    const gl = this.renderer.getContext();
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[] | null;
    const maxPoint = range ? Math.max(32, Number(range[1]) || 64) : 64;

    const shared = {
      uTime: { value: 0 },
      uMotion: { value: this.reducedMotion ? 0 : 1 },
      uLight: { value: this.theme === "light" ? 1 : 0 },
      uScale: { value: 1 },
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uRingFade: { value: this.ringFade },
    };

    this.nodeMaterial = new THREE.ShaderMaterial({
      vertexShader: NODE_VERTEX,
      fragmentShader: NODE_FRAGMENT,
      uniforms: { ...shared, uMaxSize: { value: maxPoint } },
      transparent: true,
      depthWrite: false,
    });

    this.edgeMaterial = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERTEX,
      fragmentShader: EDGE_FRAGMENT,
      uniforms: shared,
      transparent: true,
      depthWrite: false,
    });

    this.dustMaterial = new THREE.ShaderMaterial({
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uScale: shared.uScale,
        uColor: { value: new THREE.Color() },
      },
      transparent: true,
      depthWrite: false,
    });

    this.auraMaterial = new THREE.ShaderMaterial({
      vertexShader: AURA_VERTEX,
      fragmentShader: AURA_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uLight: shared.uLight,
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color("#ffd9a0") },
      },
      transparent: true,
      depthWrite: false,
    });

    this.cortexMaterial = new THREE.ShaderMaterial({
      vertexShader: CORTEX_VERTEX,
      fragmentShader: CORTEX_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uScale: shared.uScale,
        uLight: shared.uLight,
        uMaxSize: { value: maxPoint },
        uFade: { value: this.cortexFade },
        uColor: { value: new THREE.Color() },
        uSparkColor: { value: new THREE.Color("#ffd9a0") },
      },
      transparent: true,
      depthWrite: false,
    });

    this.dust = this.makeDust();
    const small = (this.container.getBoundingClientRect().width || window.innerWidth) < 640;
    this.cortex = this.makeCortex(small ? CORTEX_COUNT_SMALL : CORTEX_COUNT_LARGE);
    this.aura = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.auraMaterial);
    this.aura.scale.setScalar(3.4);
    this.aura.renderOrder = -1;

    this.scene.add(this.dust);
    this.scene.add(this.world);
    this.world.add(this.cortex);
    this.world.add(this.aura);

    this.applyTheme();
    this.bindInput(canvas);

    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    document.addEventListener("visibilitychange", this.handleVisibility);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.updateRunning();
    });
    this.intersectionObserver.observe(this.container);

    this.resize();
    this.distance = this.distanceTarget;
    this.updateRunning();
  }

  /* ---- Public API ------------------------------------------------------ */

  setGraph(graph: MindGraph): void {
    this.graph = graph;
    const previous = this.current;
    const previousSize = new Map<string, number>();
    this.nodes.forEach((n, i) => previousSize.set(n.key, this.sizeTo[i] ?? nodeSize(n)));

    this.nodes = graph.nodes;
    this.indexByKey = new Map(this.nodes.map((n, i) => [n.key, i]));

    this.to = this.nodes.map((n) => n.position);
    // Known nodes glide from where they are; new ones grow from just inside
    // where they will settle, so the network seems to grow, not pop.
    this.from = this.nodes.map((n) => previous.get(n.key) ?? (n.position.map((v) => v * 0.82) as Vec3));
    this.sizeTo = this.nodes.map(nodeSize);
    this.sizeFrom = this.nodes.map((n) => previousSize.get(n.key) ?? 0);

    this.buildNodes();
    this.buildEdges();
    this.transitionStart = this.elapsed();
    this.writePositions(0);

    this.auraMaterial.uniforms.uOpacity.value = graph.focusKey ? 1 : 0;
    const focus = graph.focusKey ? this.nodes[this.indexByKey.get(graph.focusKey) ?? -1] : null;
    if (focus) (this.auraMaterial.uniforms.uColor.value as THREE.Color).set(this.auraColor(focus));

    // A selection that no longer exists falls back to the moment.
    if (this.selectedKey && !this.indexByKey.has(this.selectedKey)) this.selectedKey = null;
    if (this.hoverKey && !this.indexByKey.has(this.hoverKey)) this.hoverKey = null;
    this.syncHighlight();
    this.kick();
  }

  setSelected(key: string | null): void {
    this.selectedKey = key && this.indexByKey.has(key) ? key : null;
    this.syncHighlight();
    this.kick();
  }

  setView(view: MindView): void {
    this.view = view;
    this.ringFadeTarget.set(...RING_FADE[view]);
    this.cortexFadeTarget = CORTEX_FADE[view];
    this.distanceTarget = this.fitDistance(VIEW_FIT[view]);
    this.kick();
  }

  setTheme(theme: MindTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.applyTheme();
    this.kick();
  }

  /**
   * Pixels hidden behind overlays at the top and bottom of the canvas (the
   * header's controls, the card). The camera's centre moves into the space
   * that is left, and each view is fitted to that space.
   */
  setInsets(top: number, bottom: number): void {
    const next = { top: Math.max(0, top), bottom: Math.max(0, bottom) };
    if (next.top === this.insets.top && next.bottom === this.insets.bottom) return;
    this.insets = next;
    this.resize();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.nodeMaterial.uniforms.uMotion.value = reduced ? 0 : 1;
    this.updateRunning();
    this.kick();
  }

  /** Attach (or detach, with null) an HTML label that follows a node. */
  bindLabel(key: string, element: HTMLElement | null): void {
    if (element) this.labels.set(key, element);
    else this.labels.delete(key);
    this.kick();
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointercancel", this.handlePointerCancel);
    canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    canvas.removeEventListener("wheel", this.handleWheel);

    this.nodePoints?.geometry.dispose();
    this.edgeLines?.geometry.dispose();
    this.dust.geometry.dispose();
    this.aura.geometry.dispose();
    this.cortex.geometry.dispose();
    this.cortexMaterial.dispose();
    this.nodeMaterial.dispose();
    this.edgeMaterial.dispose();
    this.dustMaterial.dispose();
    this.auraMaterial.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labels.clear();
  }

  /* ---- Construction ---------------------------------------------------- */

  private makeDust(): THREE.Points {
    const positions = new Float32Array(DUST_COUNT * 3);
    const seeds = new Float32Array(DUST_COUNT);
    let s = 1234567;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < DUST_COUNT; i++) {
      // Uniform in a thick shell, so the dust surrounds rather than fills.
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = 5 + rand() * 9;
      const k = Math.sqrt(1 - u * u);
      positions[i * 3] = Math.cos(theta) * k * r;
      positions[i * 3 + 1] = u * r * 0.7;
      positions[i * 3 + 2] = Math.sin(theta) * k * r;
      seeds[i] = rand();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const points = new THREE.Points(geometry, this.dustMaterial);
    points.frustumCulled = false;
    return points;
  }

  private makeCortex(count: number): THREE.Points {
    const { positions, seeds, shells } = makeCortexPoints(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute("aShell", new THREE.BufferAttribute(shells, 1));
    const points = new THREE.Points(geometry, this.cortexMaterial);
    points.frustumCulled = false;
    points.renderOrder = -2;
    return points;
  }

  private buildNodes(): void {
    if (this.nodePoints) {
      this.world.remove(this.nodePoints);
      this.nodePoints.geometry.dispose();
    }
    const n = this.nodes.length;
    const geometry = new THREE.BufferGeometry();
    const color = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const ring = new Float32Array(n);
    const index = new Float32Array(n);
    const c = new THREE.Color();

    this.nodes.forEach((node, i) => {
      c.set(node.color);
      color.set([c.r, c.g, c.b], i * 3);
      phase[i] = seedOf(node.key) * Math.PI * 2;
      ring[i] = RING_CODE[node.ring];
      index[i] = i;
    });

    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geometry.setAttribute("aRing", new THREE.BufferAttribute(ring, 1));
    geometry.setAttribute("aIndex", new THREE.BufferAttribute(index, 1));

    this.nodePoints = new THREE.Points(geometry, this.nodeMaterial);
    this.nodePoints.frustumCulled = false;
    this.nodePoints.renderOrder = 2;
    this.world.add(this.nodePoints);
  }

  private buildEdges(): void {
    if (this.edgeLines) {
      this.world.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
    }
    const edges = (this.graph?.edges ?? []).filter(
      (e) => this.indexByKey.has(e.from) && this.indexByKey.has(e.to)
    );
    const vertices = edges.length * EDGE_SEGMENTS * 2;
    const t = new Float32Array(vertices);
    const seed = new Float32Array(vertices);
    const strength = new Float32Array(vertices);
    const color = new Float32Array(vertices * 3);
    const ring = new Float32Array(vertices);
    const ends = new Float32Array(vertices * 2);
    const ca = new THREE.Color();
    const cb = new THREE.Color();
    const mixed = new THREE.Color();

    let v = 0;
    for (const edge of edges) {
      // Signals travel away from the more important end.
      let a = this.indexByKey.get(edge.from)!;
      let b = this.indexByKey.get(edge.to)!;
      const rankA = this.nodes[a].rank < 0 ? 999 : this.nodes[a].rank;
      const rankB = this.nodes[b].rank < 0 ? 999 : this.nodes[b].rank;
      if (rankB < rankA) [a, b] = [b, a];

      ca.set(this.nodes[a].color);
      cb.set(this.nodes[b].color);
      const s = seedOf(`${edge.from}>${edge.to}`);
      const r = Math.max(RING_CODE[this.nodes[a].ring], RING_CODE[this.nodes[b].ring]);

      for (let i = 0; i < EDGE_SEGMENTS; i++) {
        for (const k of [i, i + 1]) {
          const tt = k / EDGE_SEGMENTS;
          t[v] = tt;
          seed[v] = s;
          strength[v] = edge.strength;
          mixed.copy(ca).lerp(cb, tt);
          color.set([mixed.r, mixed.g, mixed.b], v * 3);
          ring[v] = r;
          ends[v * 2] = a;
          ends[v * 2 + 1] = b;
          v++;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    geometry.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geometry.setAttribute("aStrength", new THREE.BufferAttribute(strength, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geometry.setAttribute("aRing", new THREE.BufferAttribute(ring, 1));
    geometry.setAttribute("aEnds", new THREE.BufferAttribute(ends, 2));
    geometry.userData.pairs = edges.map((edge) => {
      let a = this.indexByKey.get(edge.from)!;
      let b = this.indexByKey.get(edge.to)!;
      const rankA = this.nodes[a].rank < 0 ? 999 : this.nodes[a].rank;
      const rankB = this.nodes[b].rank < 0 ? 999 : this.nodes[b].rank;
      if (rankB < rankA) [a, b] = [b, a];
      return [a, b, seedOf(`${edge.from}>${edge.to}`)];
    });

    this.edgeLines = new THREE.LineSegments(geometry, this.edgeMaterial);
    this.edgeLines.frustumCulled = false;
    this.edgeLines.renderOrder = 1;
    this.world.add(this.edgeLines);
  }

  /** Write node and edge positions for transition progress `p` (0..1). */
  private writePositions(p: number): void {
    if (!this.nodePoints) return;
    const eased = easeInOut(Math.min(1, Math.max(0, p)));
    const position = this.nodePoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const size = this.nodePoints.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const now: Vec3[] = [];

    this.nodes.forEach((node, i) => {
      const at = lerp3(this.from[i], this.to[i], eased);
      now.push(at);
      position.setXYZ(i, at[0], at[1], at[2]);
      size.setX(i, this.sizeFrom[i] + (this.sizeTo[i] - this.sizeFrom[i]) * eased);
      this.current.set(node.key, at);
    });
    // Forget nodes that are gone, so a node that returns grows in again.
    if (this.current.size > this.nodes.length) {
      for (const key of this.current.keys()) if (!this.indexByKey.has(key)) this.current.delete(key);
    }
    position.needsUpdate = true;
    size.needsUpdate = true;

    if (!this.edgeLines) return;
    const edgePosition = this.edgeLines.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pairs = this.edgeLines.geometry.userData.pairs as Array<[number, number, number]>;
    let v = 0;
    for (const [a, b, s] of pairs) {
      const pa = now[a];
      const pb = now[b];
      // A quadratic curve bowed gently toward the centre, with a little
      // sideways twist per edge, so pathways read as grown, not ruled.
      const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      const bow = 0.78 + s * 0.12;
      const twist = (s - 0.5) * 0.6;
      const control: Vec3 = [mid[0] * bow + twist, mid[1] * bow - twist * 0.5, mid[2] * bow + twist * 0.3];
      let prev: Vec3 = pa;
      for (let i = 1; i <= EDGE_SEGMENTS; i++) {
        const t = i / EDGE_SEGMENTS;
        const u = 1 - t;
        const point: Vec3 = [
          u * u * pa[0] + 2 * u * t * control[0] + t * t * pb[0],
          u * u * pa[1] + 2 * u * t * control[1] + t * t * pb[1],
          u * u * pa[2] + 2 * u * t * control[2] + t * t * pb[2],
        ];
        edgePosition.setXYZ(v++, prev[0], prev[1], prev[2]);
        edgePosition.setXYZ(v++, point[0], point[1], point[2]);
        prev = point;
      }
    }
    edgePosition.needsUpdate = true;
  }

  private auraColor(node: MindNode): string {
    // The moment glows warm whatever it is, tinted toward its own colour.
    const warm = new THREE.Color("#ffd9a0");
    return "#" + warm.lerp(new THREE.Color(node.color), 0.35).getHexString();
  }

  private applyTheme(): void {
    const light = this.theme === "light";
    this.nodeMaterial.uniforms.uLight.value = light ? 1 : 0;
    // Light on dark adds up like light; on a light ground it layers like ink.
    const blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const material of [
      this.nodeMaterial,
      this.edgeMaterial,
      this.dustMaterial,
      this.auraMaterial,
      this.cortexMaterial,
    ]) {
      material.blending = blending;
      material.needsUpdate = true;
    }
    (this.dustMaterial.uniforms.uColor.value as THREE.Color).set(light ? "#7a86a8" : "#b9c6ff");
    (this.cortexMaterial.uniforms.uColor.value as THREE.Color).set(light ? "#6a78ad" : "#9fb0ff");
    (this.cortexMaterial.uniforms.uSparkColor.value as THREE.Color).set(light ? "#d9822b" : "#ffd9a0");
  }

  /* ---- Layout ---------------------------------------------------------- */

  private fitDistance(radius: number): number {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    // Fit to the part of the canvas no overlay covers.
    const visible = Math.max(0.35, (this.height - this.insets.top - this.insets.bottom) / this.height);
    const vFit = 2 * Math.atan(Math.tan(vFov / 2) * visible);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFit, hFov);
    return radius / Math.sin(fov / 2);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    // Slide the picture so the brain's centre sits in the middle of the space
    // the overlays leave, not behind the card.
    const shift = Math.round((this.insets.bottom - this.insets.top) / 2);
    if (shift !== 0) {
      this.camera.setViewOffset(this.width, this.height, 0, shift, this.width, this.height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();

    const bufferHeight = this.height * this.renderer.getPixelRatio();
    const scale = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.nodeMaterial.uniforms.uScale.value = scale;

    this.distanceTarget = this.fitDistance(VIEW_FIT[this.view]);
    this.kick();
  }

  /* ---- Highlight ------------------------------------------------------- */

  private syncHighlight(): void {
    const hover = this.hoverKey ? this.indexByKey.get(this.hoverKey) ?? -1 : -1;
    const selected = this.selectedKey ? this.indexByKey.get(this.selectedKey) ?? -1 : -1;
    this.nodeMaterial.uniforms.uHover.value = hover;
    this.nodeMaterial.uniforms.uSelected.value = selected;
  }

  /* ---- Input ----------------------------------------------------------- */

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerCancel);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  private zoomStep(direction: 1 | -1): void {
    const now = performance.now();
    if (now - this.lastZoomStepAt < 450) return;
    this.lastZoomStepAt = now;
    this.lastInteraction = now;
    this.options.onInteract?.();
    this.options.onZoomStep?.(direction);
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Lines and pages become pixels, roughly.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    this.wheelAccum += event.deltaY * unit;
    if (Math.abs(this.wheelAccum) < 90) return;
    this.zoomStep(this.wheelAccum > 0 ? 1 : -1);
    this.wheelAccum = 0;
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      // A second finger turns a drag into a pinch.
      this.dragging = false;
      this.pinchStart = this.pinchDistance();
      return;
    }
    const now = performance.now();
    this.dragging = true;
    this.downPointer = { x: event.clientX, y: event.clientY, t: now };
    this.lastPointer = { x: event.clientX, y: event.clientY, t: now };
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    if (event.pointerType === "mouse") {
      try {
        this.renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; dragging still works without it.
      }
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (this.pinchStart !== null && this.pointers.size >= 2) {
      const ratio = this.pinchDistance() / Math.max(1, this.pinchStart);
      // Fingers apart looks closer; together looks wider.
      if (ratio > 1.3 || ratio < 0.77) {
        this.zoomStep(ratio > 1 ? -1 : 1);
        this.pinchStart = this.pinchDistance();
      }
      return;
    }
    if (this.dragging) {
      const now = performance.now();
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      const dt = Math.max(1, now - this.lastPointer.t);
      const turn = 0.0055;
      this.yaw += dx * turn;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * turn, -0.7, 0.7);
      this.yawVelocity = (dx * turn) / dt;
      this.pitchVelocity = (dy * turn) / dt;
      this.lastPointer = { x: event.clientX, y: event.clientY, t: now };
      if (Math.hypot(event.clientX - this.downPointer.x, event.clientY - this.downPointer.y) > 6) {
        this.lastInteraction = now;
        this.options.onInteract?.();
      }
      this.kick();
      return;
    }
    if (event.pointerType !== "mouse") return;
    const key = this.pick(event.clientX, event.clientY);
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.syncHighlight();
      this.renderer.domElement.style.cursor = key ? "pointer" : "grab";
      this.options.onHover?.(key);
      this.kick();
    }
  };

  private releasePointer(event: PointerEvent): boolean {
    this.pointers.delete(event.pointerId);
    if (this.pinchStart === null) return false;
    // The rest of a pinch is not a tap or a drag.
    if (this.pointers.size < 2) this.pinchStart = null;
    return true;
  }

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.releasePointer(event)) return;
    if (!this.dragging) return;
    this.dragging = false;
    const moved = Math.hypot(event.clientX - this.downPointer.x, event.clientY - this.downPointer.y);
    const quick = performance.now() - this.downPointer.t < 500;
    if (moved < 7 && quick) {
      this.options.onInteract?.();
      this.options.onSelect?.(this.pick(event.clientX, event.clientY));
    }
    this.kick();
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    // The browser took the gesture. Keep any spin.
    this.releasePointer(event);
    this.dragging = false;
  };

  private handlePointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && this.hoverKey) {
      this.hoverKey = null;
      this.syncHighlight();
      this.options.onHover?.(null);
      this.kick();
    }
  };

  /** The node under a screen point, if any: nearest centre within its glow. */
  private pick(clientX: number, clientY: number): string | null {
    if (!this.nodePoints || this.nodes.length === 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const scale = this.nodeMaterial.uniforms.uScale.value / this.renderer.getPixelRatio();
    const fade = this.ringFade;
    const fades = [fade.x, fade.y, fade.z, fade.w];

    let best: string | null = null;
    let bestScore = Infinity;
    this.world.updateMatrixWorld();

    this.nodes.forEach((node, i) => {
      if (fades[RING_CODE[node.ring]] < 0.3) return; // faded rings are not targets
      const at = this.current.get(node.key);
      if (!at) return;
      this.scratch.set(at[0], at[1], at[2]).applyMatrix4(this.world.matrixWorld);
      const depth = this.scratch.distanceTo(this.camera.position);
      this.scratch.project(this.camera);
      if (this.scratch.z > 1) return;
      const sx = (this.scratch.x * 0.5 + 0.5) * this.width;
      const sy = (-this.scratch.y * 0.5 + 0.5) * this.height;
      const radius = Math.max(16, ((this.sizeTo[i] * scale) / depth) * 0.32);
      const d = Math.hypot(sx - x, sy - y);
      if (d > radius) return;
      // Prefer the nearest centre, and on a tie the one in front.
      const score = d / radius + depth * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = node.key;
      }
    });
    return best;
  }

  /* ---- Loop ------------------------------------------------------------ */

  private handleVisibility = (): void => {
    this.updateRunning();
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.options.onError?.(new Error("WebGL context lost"));
  };

  /** Seconds since the scene was made: the clock every shader runs on. */
  private elapsed(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  /** Ask for at least one more frame (and a few while things settle). */
  private kick(): void {
    this.needsRender = true;
    this.updateRunning(true);
  }

  private updateRunning(force = false): void {
    if (this.disposed) return;
    const shouldRun =
      this.visible &&
      document.visibilityState !== "hidden" &&
      (!this.reducedMotion || force || this.needsRender);
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastFrameAt = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.running && !force) {
      this.running = false;
      cancelAnimationFrame(this.frame);
    }
  }

  private tick = (): void => {
    if (!this.running || this.disposed) return;
    const frameAt = performance.now();
    const dt = Math.min(0.05, (frameAt - this.lastFrameAt) / 1000);
    this.lastFrameAt = frameAt;
    const time = this.elapsed();
    const motion = !this.reducedMotion;
    let settling = false;

    this.nodeMaterial.uniforms.uTime.value = time;

    // Graph transition.
    if (this.transitionStart >= 0) {
      const p = (time - this.transitionStart) / (TRANSITION_MS / 1000);
      this.writePositions(this.reducedMotion ? 1 : p);
      if (p >= 1 || this.reducedMotion) this.transitionStart = -1;
      else settling = true;
    }

    // Rotation: inertia after a drag, then a slow idle drift when nobody has
    // touched it for a while and nothing is selected.
    if (!this.dragging) {
      const friction = Math.pow(0.04, dt);
      this.yaw += this.yawVelocity * dt * 1000;
      this.pitch = THREE.MathUtils.clamp(this.pitch + this.pitchVelocity * dt * 1000, -0.7, 0.7);
      this.yawVelocity *= friction;
      this.pitchVelocity *= friction;
      if (Math.abs(this.yawVelocity) + Math.abs(this.pitchVelocity) > 1e-5) settling = true;

      const idle = performance.now() - this.lastInteraction > 4000;
      if (motion && idle && !this.selectedKey) {
        this.yaw += dt * 0.045;
        // Drift back toward a pleasant tilt.
        this.pitch += (0.12 - this.pitch) * Math.min(1, dt * 0.3);
      }
    }
    this.world.rotation.set(this.pitch, this.yaw, 0);
    this.world.updateMatrixWorld();

    // Ring fade toward the current view.
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 3.5);
    this.ringFade.lerp(this.ringFadeTarget, k);
    if (this.ringFade.clone().sub(this.ringFadeTarget).lengthSq() > 1e-5) settling = true;
    this.cortexFade += (this.cortexFadeTarget - this.cortexFade) * k;
    if (Math.abs(this.cortexFadeTarget - this.cortexFade) > 1e-3) settling = true;
    this.cortexMaterial.uniforms.uFade.value = this.cortexFade;

    // Camera: look at the selected node (or the centre), at the view's distance.
    const selected = this.selectedKey ? this.current.get(this.selectedKey) : null;
    if (selected) {
      this.scratch.set(selected[0], selected[1], selected[2]).applyMatrix4(this.world.matrixWorld);
      // Lean toward the node without abandoning the centre entirely.
      this.scratch.multiplyScalar(0.7);
    } else {
      this.scratch.set(0, 0, 0);
    }
    const before = this.target.clone();
    this.target.lerp(this.scratch, k * 0.8);
    this.distance += (this.distanceTarget - this.distance) * k * 0.8;
    if (before.distanceToSquared(this.target) > 1e-6 || Math.abs(this.distanceTarget - this.distance) > 1e-3) {
      settling = true;
    }
    this.camera.position.set(this.target.x, this.target.y, this.target.z + this.distance);
    this.camera.lookAt(this.target);

    // The aura always faces the viewer.
    this.aura.quaternion.copy(this.world.quaternion).invert().multiply(this.camera.quaternion);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.needsRender = false;

    const keepGoing = motion || settling || this.dragging;
    if (keepGoing && this.visible && document.visibilityState !== "hidden") {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.running = false;
    }
  };

  /**
   * Move each bound label to its node's place on screen. Items' labels win
   * over hubs', and a label that would overlap one already placed is hidden
   * for that frame, so names never pile on top of each other.
   */
  private updateLabels(): void {
    if (this.labels.size === 0) return;
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const ordered = [...this.labels.entries()].sort(([a], [b]) => {
      const ha = this.nodes[this.indexByKey.get(a) ?? -1]?.kind === "hub" ? 1 : 0;
      const hb = this.nodes[this.indexByKey.get(b) ?? -1]?.kind === "hub" ? 1 : 0;
      return ha - hb;
    });
    for (const [key, element] of ordered) {
      const at = this.current.get(key);
      const index = this.indexByKey.get(key);
      if (!at || index === undefined) {
        element.style.opacity = "0";
        continue;
      }
      this.scratch.set(at[0], at[1], at[2]).applyMatrix4(this.world.matrixWorld);
      const depth = this.scratch.distanceTo(this.camera.position);
      this.scratch.project(this.camera);
      if (this.scratch.z > 1) {
        element.style.opacity = "0";
        continue;
      }
      const sx = (this.scratch.x * 0.5 + 0.5) * this.width;
      const sy = (-this.scratch.y * 0.5 + 0.5) * this.height;
      const scale = this.nodeMaterial.uniforms.uScale.value / this.renderer.getPixelRatio();
      const offset = Math.min(60, ((this.sizeTo[index] * scale) / depth) * 0.22) + 8;
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      const box = { x0: sx - w / 2 - 4, y0: sy + offset - 2, x1: sx + w / 2 + 4, y1: sy + offset + h + 2 };
      const overlaps = placed.some(
        (p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0
      );
      element.style.transform = `translate3d(${sx.toFixed(1)}px, ${(sy + offset).toFixed(1)}px, 0) translateX(-50%)`;
      if (overlaps) {
        element.style.opacity = "0";
        continue;
      }
      placed.push(box);
      element.style.opacity = "1";
    }
  }
}
