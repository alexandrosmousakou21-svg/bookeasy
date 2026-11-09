import * as THREE from "three";

const vertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vHeight;
  void main() {
    vUv = uv;
    vec3 displaced = position;
    float wave = sin(position.x * 2.2 + uTime * 0.32) * cos(position.y * 1.8 - uTime * 0.24);
    wave += sin(position.x * 3.8 - position.y * 2.3 + uTime * 0.18) * 0.35;
    displaced.z += wave * 0.16;
    vHeight = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uTone;
  uniform vec2 uPointer;
  varying vec2 vUv;
  varying float vHeight;
  float ribbon(vec2 uv, float offset, float phase, float width) {
    float curve = offset + 0.12 * sin(uv.x * 4.2 + phase) + 0.07 * sin(uv.x * 8.0 - phase * 0.7);
    return exp(-abs(uv.y - curve) * width);
  }
  void main() {
    vec2 uv = vUv + uPointer * 0.025;
    float wave = sin(uv.x * 9.0 + uv.y * 6.0 + sin(uv.y * 5.0 - uTime * 0.19) * 1.9 + uTime * 0.24);
    float wave2 = cos(uv.x * 5.0 - uv.y * 9.0 + uTime * 0.18);
    float light = pow(max(0.0, wave * 0.5 + 0.5), 7.0);
    // Brand palette: Sage Gray, Light Slate Blue, Soft Indigo, Lime, Deep Olive.
    vec3 sage = vec3(0.894, 0.898, 0.890);
    vec3 slate = vec3(0.431, 0.604, 0.784);
    vec3 indigo = vec3(0.341, 0.396, 0.761);
    vec3 lime = vec3(0.635, 0.769, 0.188);
    vec3 olive = vec3(0.251, 0.298, 0.118);
    vec3 night = vec3(0.150, 0.180, 0.063);
    float field = clamp(0.5 + wave * 0.30 + wave2 * 0.18 + vHeight * 0.08, 0.0, 1.0);
    vec3 dayColor = mix(sage, mix(sage, slate, 0.34), field);
    dayColor = mix(dayColor, indigo, max(0.0, -wave2) * 0.05);
    vec3 nightColor = mix(night, olive, field * 0.85);
    nightColor = mix(nightColor, indigo, max(0.0, wave2) * 0.20);
    vec3 color = mix(dayColor, nightColor, uTone);
    float flow = ribbon(uv, 0.30, uTime * 0.18, 58.0);
    flow += ribbon(uv, 0.49, uTime * 0.14 + 1.8, 84.0) * 0.75;
    flow += ribbon(uv, 0.72, uTime * 0.12 + 3.5, 110.0) * 0.5;
    color += flow * mix(vec3(0.05, 0.08, 0.12), vec3(0.18, 0.30, 0.10), uTone);
    color += light * mix(vec3(0.05, 0.06, 0.04), lime * 0.22, uTone);
    float particles = 0.0;
    for (int index = 0; index < PARTICLE_COUNT; index++) {
      float seed = float(index);
      vec2 center = vec2(0.5 + 0.43 * sin(seed * 2.4 + uTime * (0.025 + seed * 0.002)),
                         0.5 + 0.40 * cos(seed * 1.7 + uTime * (0.02 + seed * 0.003)));
      particles += 1.0 - smoothstep(0.002, 0.006, length(uv - center));
    }
    color += particles * mix(vec3(0.10, 0.12, 0.08), lime * 0.55, uTone);
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
    uniforms: { uTime: { value: 0 }, uTone: { value: 0 }, uPointer: { value: new THREE.Vector2() } },
  });
  scene.add(new THREE.Mesh(geometry, material));
  const pointerTarget = new THREE.Vector2();
  const floating = new THREE.Group();
  const floatingGeometries = [];
  const floatingMaterials = [];
  const strandCount = lowPower ? 2 : 3;
  for (let strand = 0; strand < strandCount; strand += 1) {
    const points = [];
    for (let step = 0; step <= 64; step += 1) {
      const position = step / 64;
      points.push(new THREE.Vector3(
        position * 2.8 - 1.4,
        Math.sin(position * 5 + strand * 1.4) * .17 + (strand - 1) * .4,
        .18 + Math.cos(position * 4 + strand) * .1,
      ));
    }
    const strandGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const strandMaterial = new THREE.LineBasicMaterial({ color: 0xa2c430, transparent: true, opacity: .34, depthWrite: false });
    floatingGeometries.push(strandGeometry);
    floatingMaterials.push(strandMaterial);
    floating.add(new THREE.Line(strandGeometry, strandMaterial));
  }
  const particlePositions = [];
  const particleCount = lowPower ? 18 : 36;
  for (let index = 0; index < particleCount; index += 1) {
    particlePositions.push(
      Math.sin(index * 9.7) * 1.05,
      Math.cos(index * 4.3) * .95,
      .22 + (index % 5) * .05,
    );
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.Float32BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: lowPower ? 2 : 3, sizeAttenuation: false, transparent: true, opacity: .6, depthWrite: false });
  floatingGeometries.push(particleGeometry);
  floatingMaterials.push(particleMaterial);
  floating.add(new THREE.Points(particleGeometry, particleMaterial));
  scene.add(floating);

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
    pointerTarget.set(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
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
    const toneTarget = canvas.parentElement?.dataset.scene === "home" ? 1 : 0;
    const tone = material.uniforms.uTone;
    tone.value += (toneTarget - tone.value) * Math.min(1, delta * 2.2);
    material.uniforms.uPointer.value.lerp(pointerTarget, 0.035);
    floating.rotation.z = Math.sin(elapsed * .08) * .04;
    floating.position.x = material.uniforms.uPointer.value.x * .06;
    floating.position.y = Math.sin(elapsed * .12) * .025 - material.uniforms.uPointer.value.y * .04;
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
    floatingGeometries.forEach((item) => item.dispose());
    floatingMaterials.forEach((item) => item.dispose());
    renderer.dispose();
    canvas.style.visibility = "";
  };
}