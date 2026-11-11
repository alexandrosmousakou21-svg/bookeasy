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

  // BOOKEASY_LIVE_LAVENDER_BUBBLES
  float softBubble(vec2 uv, vec2 center, float radius) {
    float d = length(uv - center);
    float halo = exp(-(d * d) / (radius * radius * 1.8));
    float core = 1.0 - smoothstep(radius * 0.25, radius, d);
    float rim = exp(-pow((d - radius * 0.76) / (radius * 0.12), 2.0));
    return halo * 0.20 + core * 0.08 + rim * 0.09;
  }
  void main() {
    vec2 uv = vUv + uPointer * 0.025;
    float wave = sin(uv.x * 9.0 + uv.y * 6.0 + sin(uv.y * 5.0 - uTime * 0.19) * 1.9 + uTime * 0.24);
    float wave2 = cos(uv.x * 5.0 - uv.y * 9.0 + uTime * 0.18);
    float light = pow(max(0.0, wave * 0.5 + 0.5), 7.0);
    // Warm cream and ivory ambient palette. Brand greens remain in the UI.
    vec3 sage = vec3(0.961, 0.945, 0.910);
    vec3 softLavender = vec3(0.988, 0.980, 0.961);
    vec3 lavender = vec3(0.918, 0.894, 0.847);
    vec3 violet = vec3(0.863, 0.835, 0.784);
    vec3 deepViolet = vec3(0.941, 0.922, 0.882);
    vec3 green = vec3(0.635, 0.769, 0.188);
    vec3 darkViolet = vec3(0.918, 0.894, 0.847);
    vec3 night = vec3(0.949, 0.933, 0.898);
    float field = clamp(0.5 + wave * 0.30 + wave2 * 0.18 + vHeight * 0.08, 0.0, 1.0);
    vec3 dayColor = mix(sage, mix(sage, softLavender, 0.20), field);
    dayColor = mix(dayColor, deepViolet, max(0.0, -wave2) * 0.04);
    vec3 nightColor = mix(night, mix(darkViolet, deepViolet, 0.25), field * 0.85);
    nightColor = mix(nightColor, lavender, max(0.0, wave2) * 0.12);
    vec3 color = mix(dayColor, nightColor, uTone);

    // Three gently drifting translucent lavender bubbles
    float bubbleTime = uTime * 0.10;
    float bubbleField = 0.0;

    bubbleField += softBubble(
      uv,
      vec2(0.16 + sin(bubbleTime) * 0.055,
           0.28 + cos(bubbleTime * 0.75) * 0.065),
      0.105
    );

    bubbleField += softBubble(
      uv,
      vec2(0.80 + cos(bubbleTime * 0.70) * 0.045,
           0.70 + sin(bubbleTime * 0.85) * 0.060),
      0.125
    );

    bubbleField += softBubble(
      uv,
      vec2(0.53 + sin(bubbleTime * 0.55) * 0.035,
           0.12 + cos(bubbleTime * 0.90) * 0.035),
      0.070
    );

    // Pale lilac body and soft white reflections
    color += vec3(0.72, 0.62, 0.86) * bubbleField * 0.16;
    color += vec3(0.99, 0.97, 1.00) * bubbleField * 0.045;
    float flow = ribbon(uv, 0.30, uTime * 0.18, 58.0);
    flow += ribbon(uv, 0.49, uTime * 0.14 + 1.8, 84.0) * 0.75;
    flow += ribbon(uv, 0.72, uTime * 0.12 + 3.5, 110.0) * 0.5;
    // Soft ivory ribbons and neutral highlights.
    color += flow * vec3(0.035, 0.032, 0.026);
    color += light * vec3(0.035, 0.032, 0.026);
    float particles = 0.0;
    for (int index = 0; index < PARTICLE_COUNT; index++) {
      float seed = float(index);
      vec2 center = vec2(0.5 + 0.43 * sin(seed * 2.4 + uTime * (0.025 + seed * 0.002)),
                         0.5 + 0.40 * cos(seed * 1.7 + uTime * (0.02 + seed * 0.003)));
      particles += 1.0 - smoothstep(0.002, 0.006, length(uv - center));
    }
    color += particles * softLavender * 0.06;
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
    const strandMaterial = new THREE.LineBasicMaterial({ color: 0x9dbb83, transparent: true, opacity: .34, depthWrite: false });
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
    const toneTarget = 1;
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