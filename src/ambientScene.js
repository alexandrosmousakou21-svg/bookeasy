import * as THREE from "three";

const vertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeight;
  void main() {
    vUv = uv;
    vec3 displaced = position;
    float wave = sin(position.x * 2.2 + uTime * 0.19) * cos(position.y * 1.8 - uTime * 0.14);
    wave += sin(position.x * 3.8 - position.y * 2.3 + uTime * 0.11) * 0.35;
    displaced.z += wave * 0.11;
    vHeight = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec2 uPointer;
  varying vec2 vUv;
  varying float vHeight;
  void main() {
    vec2 uv = vUv + uPointer * 0.012;
    float wave = sin(uv.x * 8.0 + uv.y * 5.0 + sin(uv.y * 4.0 - uTime * 0.12) * 1.7 + uTime * 0.16);
    float wave2 = cos(uv.x * 5.0 - uv.y * 8.0 + uTime * 0.11);
    float light = smoothstep(0.58, 1.0, wave * 0.5 + 0.5) * 0.22;
    vec3 powder = vec3(0.945, 0.965, 0.957);
    vec3 mint = vec3(0.851, 0.910, 0.890);
    vec3 ocean = vec3(0.067, 0.298, 0.353);
    vec3 color = mix(powder, mint, clamp(0.52 + wave * 0.27 + wave2 * 0.14 + vHeight * 0.09, 0.0, 0.92));
    color = mix(color, ocean, 0.035 + light * 0.15);
    color += light * vec3(0.12, 0.14, 0.12);
    float particles = 0.0;
    for (int index = 0; index < PARTICLE_COUNT; index++) {
      float seed = float(index);
      vec2 center = vec2(0.5 + 0.43 * sin(seed * 2.4 + uTime * (0.025 + seed * 0.002)),
                         0.5 + 0.40 * cos(seed * 1.7 + uTime * (0.02 + seed * 0.003)));
      particles += 1.0 - smoothstep(0.002, 0.006, length(uv - center));
    }
    color += particles * vec3(0.045, 0.038, 0.012);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function startAmbientScene(canvas) {
  let renderer;
  try {
    const context = canvas.getContext("webgl2", { antialias: false, powerPreference: "low-power" });
    if (!context) return () => {};
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, powerPreference: "low-power" });
  } catch {
    return () => {};
  }

  const lowPower = window.matchMedia("(max-width: 800px), (pointer: coarse)").matches ||
    navigator.connection?.saveData ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4);
  let pixelRatio = Math.min(window.devicePixelRatio || 1, lowPower ? 0.75 : 1.5);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const geometry = new THREE.PlaneGeometry(2.2, 2.2, lowPower ? 16 : 48, lowPower ? 16 : 48);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: { PARTICLE_COUNT: lowPower ? 3 : 6 },
    uniforms: { uTime: { value: 0 }, uPointer: { value: new THREE.Vector2() } },
  });
  scene.add(new THREE.Mesh(geometry, material));

  let frame = 0;
  let timer = 0;
  let previous = 0;
  let elapsed = 0;
  let slowFrames = 0;
  let stopped = false;
  let contextUnavailable = false;
  const frameInterval = lowPower ? 1000 / 20 : 1000 / 40;

  const cancelScheduled = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    frame = 0;
    timer = 0;
  };

  const resize = () => {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  const pointer = (event) => {
    material.uniforms.uPointer.value.set(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
  };
  const render = (time) => {
    frame = 0;
    if (stopped || contextUnavailable || document.hidden) return;
    const delta = previous ? Math.min((time - previous) / 1000, 0.1) : 0;
    if (previous && time - previous > 80) slowFrames += 1;
    previous = time;
    elapsed += delta;
    if (slowFrames > 30 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      slowFrames = 0;
      resize();
    }
    material.uniforms.uTime.value = elapsed;
    try {
      renderer.render(scene, camera);
      timer = window.setTimeout(() => {
        timer = 0;
        frame = requestAnimationFrame(render);
      }, frameInterval);
    } catch {
      contextUnavailable = true;
      canvas.style.visibility = "hidden";
    }
  };
  const visibility = () => {
    cancelScheduled();
    previous = 0;
    if (!document.hidden && !stopped && !contextUnavailable) frame = requestAnimationFrame(render);
  };
  const contextLost = (event) => {
    event.preventDefault();
    contextUnavailable = true;
    cancelScheduled();
    canvas.style.visibility = "hidden";
  };
  const contextRestored = () => {
    if (stopped) return;
    try {
      resize();
      renderer.render(scene, camera);
      if (renderer.getContext().isContextLost()) throw new Error("WebGL context unavailable");
      contextUnavailable = false;
      canvas.style.visibility = "";
      visibility();
    } catch {
      contextUnavailable = true;
      canvas.style.visibility = "hidden";
    }
  };

  resize();
  window.addEventListener("resize", resize, { passive: true });
  if (!lowPower) window.addEventListener("pointermove", pointer, { passive: true });
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  if (!document.hidden) frame = requestAnimationFrame(render);

  return () => {
    stopped = true;
    cancelScheduled();
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", pointer);
    document.removeEventListener("visibilitychange", visibility);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    canvas.style.visibility = "";
  };
}