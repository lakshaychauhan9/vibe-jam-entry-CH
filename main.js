// ====================================
// CONSTANTS AND GLOBAL VARIABLES
// ====================================
const MAX_Y_ROTATION = Math.PI; // 180 degrees left/right (π radians)
const MAX_X_ROTATION = Math.PI / 3; // 60 degrees up/down (π/3 radians)
const ROTATION_SPEED = 0.03; // Slower, more precise control
const CAMERA_RETURN_SPEED = 0.008; // Faster return to center
const CUBE_SIZE = 1600;
const AVATAR_MOVEMENT_SPEED = 2;
const AVATAR_ROTATION_SPEED = 0.01;
const LASER_MAX_DURATION = 5; // 5 seconds
const LASER_COOLDOWN_DURATION = 0.5; // 0.5 seconds
const GAME_DURATION = 300; // 2 minutes (in seconds)
const STAR_COUNT = 1000;

// Planet configuration
const PLANET_CONFIG = {
  common: {
    count: 40,
    minPoints: 50,
    maxPoints: 150,
    minSize: 90,
    maxSize: 100,
    minDistance: 2400,
    maxDistance: 3000,
    colors: [0x8888ff, 0x88ff88, 0xffaa88, 0xaaaaaa, 0x88ddff],
  },
  exotic: {
    count: 14,
    minPoints: 200,
    maxPoints: 350,
    minSize: 100,
    maxSize: 130,
    minDistance: 2600,
    maxDistance: 3200,
    colors: [0xff8800, 0x00ffaa, 0xaa00ff, 0xff88ff, 0xffff00],
  },
  rare: {
    count: 6,
    minPoints: 500,
    maxPoints: 800,
    minSize: 120,
    maxSize: 180,
    minDistance: 2500,
    maxDistance: 3500,
    colors: [0xff0088, 0x00ffff, 0xdd00ff, 0xff0000, 0x00ff00],
  },
};

// Scene elements
let scene, camera, renderer;
let ambientLight, pointLight;
let cube, avatar, avatarHead;
let stars,
  planets = [];
let laser = null;
let raycaster, mouse;

// Game state
let score = 0;
let gameTime = 0;
let gameOver = false;
let laserActive = false;
let laserTime = 0;
let cooldownTime = 0;
let cameraAngleX = 0;
let cameraAngleY = 0;
const cameraDistance = -25;
const avatarHeadOffset = new THREE.Vector3(0, 1.5, 0);

// Controls state
const controls = {
  forward: false,
  backward: false,
  rotateLeft: false,
  rotateRight: false,
  up: false,
  down: false,
  cameraLeft: false,
  cameraRight: false,
  cameraUp: false,
  cameraDown: false,
};

// Shader for dissolve effect
const dissolveVertexShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  uniform float uTime;
  
  void main() {
    vUv = uv;
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 8.0; // Size of particles
  }
`;

const dissolveFragmentShader = `
  varying vec2 vUv;
  varying vec3 vPosition;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uDissolve;

  void main() {
    float noise = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
    float dissolveFactor = smoothstep(uDissolve - 0.2, uDissolve + 0.2, noise);
    if (dissolveFactor < 0.1) discard;
    float glow = 1.0 - dissolveFactor;
    vec3 color = mix(uColor, vec3(1.0), glow * 0.5);
    gl_FragColor = vec4(color, dissolveFactor * (1.0 - uDissolve));
  }
`;

// ====================================
// INITIALIZATION
// ====================================
function initScene() {
  // Create scene
  scene = new THREE.Scene();

  // Create camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    10000
  );

  // Create renderer
  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Create lights
  ambientLight = new THREE.AmbientLight(0x404040, 2);
  scene.add(ambientLight);

  pointLight = new THREE.PointLight(0xffffff, 1.5, 4000);
  pointLight.position.set(0, 10, 10);
  scene.add(pointLight);

  // Initialize raycaster and mouse
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  createPlatforms();
}

function createPlayableCube() {
  const cubeGeometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
  const cubeMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    wireframe: false,
    depthTest: false, // Ensures it doesn’t interfere with depth rendering
    depthWrite: false,
    vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `void main() { discard; }`, // Completely removes it from rendering
  });
  cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
  scene.add(cube);
}

function loadAvatar() {
  const loader = new THREE.GLTFLoader();
  loader.load(
    "assets/avatar.glb",
    function (gltf) {
      avatar = gltf.scene;
      avatar.scale.set(5, 5, 5);
      avatar.position.set(0, 0, 0);
      scene.add(avatar);

      avatarHead = new THREE.Object3D();
      avatarHead.position.copy(avatarHeadOffset);
      avatar.add(avatarHead);

      // Add dynamic lighting (moved to separate step below)
      initAvatarLighting();

      animate();
    },
    undefined,
    function (error) {
      console.error("Error loading avatar:", error);
      createSimpleAvatar();
      animate();
    }
  );
}

function createSimpleAvatar() {
  const avatarGeometry = new THREE.SphereGeometry(2, 32, 32);
  const avatarMaterial = new THREE.MeshPhongMaterial({
    color: 0xffffff, // Neutral white to show original texture if present
    emissive: 0x333333,
  });
  avatar = new THREE.Mesh(avatarGeometry, avatarMaterial);
  scene.add(avatar);

  avatarHead = new THREE.Object3D();
  avatarHead.position.set(0, 3, 0);
  avatar.add(avatarHead);

  initAvatarLighting();
  initAvatarTrail();
}

function createPlanets() {
  // Clear existing planets
  planets = [];
  scene.children = scene.children.filter((child) => !planets.includes(child));

  // Create initial planets for each category
  createPlanetCategory("common", 40);
  createPlanetCategory("exotic", 40);
  createPlanetCategory("rare", 20);
}

function createPlanetCategory(category, count) {
  for (let i = 0; i < count; i++) {
    createSinglePlanet(category);
  }
}

function createPlanetCategory(category) {
  const config = PLANET_CONFIG[category];

  for (let i = 0; i < config.count; i++) {
    createSinglePlanet(category);
  }
}

function createSinglePlanet(category) {
  const config = PLANET_CONFIG[category];

  // Get random position on a sphere with radius between min and max distance
  const distance =
    Math.random() * (config.maxDistance - config.minDistance) +
    config.minDistance;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);

  const x = distance * Math.sin(phi) * Math.cos(theta);
  const y = distance * Math.sin(phi) * Math.sin(theta);
  const z = distance * Math.cos(phi);

  // Random size within range
  const size =
    Math.random() * (config.maxSize - config.minSize) + config.minSize;

  // Random color from the category's color palette
  const colorIndex = Math.floor(Math.random() * config.colors.length);
  const color = config.colors[colorIndex];

  // Random points within the category's range
  const points =
    Math.floor(Math.random() * (config.maxPoints - config.minPoints + 1)) +
    config.minPoints;

  addFancyPlanet(category, color, x, y, z, size, points);
}

function addFancyPlanet(category, color, x, y, z, size, points) {
  const planetGroup = new THREE.Group();

  // Base geometry for the planet
  const planetGeometry = new THREE.SphereGeometry(size, 32, 32);

  // Define a palette of colors for the rippling effect
  const baseColor = new THREE.Color(color);

  // Planet shader (unchanged from previous update)
  const planetMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: baseColor },
      uSize: { value: 2.0 + Math.random() * 2.0 },
      uSpeed: { value: 0.2 + Math.random() * 0.3 },
      uIntensity: { value: 1.0 },
      uMetallic: {
        value: category === "rare" ? 0.9 : category === "exotic" ? 0.7 : 0.5,
      },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vPosition = position;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform float uSize;
      uniform float uSpeed;
      uniform float uIntensity;
      uniform float uMetallic;
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;

      float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 perm(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

      float noise(vec3 p) {
        vec3 a = floor(p);
        vec3 d = p - a;
        d = d * d * (3.0 - 2.0 * d);

        vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
        vec4 k1 = perm(b.xyxy);
        vec4 k2 = perm(k1.xyxy + b.zzww);

        vec4 c = k2 + a.zzzz;
        vec4 k3 = perm(c);
        vec4 k4 = perm(c + 1.0);

        vec4 o1 = fract(k3 * (1.0 / 41.0));
        vec4 o2 = fract(k4 * (1.0 / 41.0));

        vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
        vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

        return o4.y * d.y + o4.x * (1.0 - d.y);
      }

      float noise2d(vec2 p) {
        return noise(vec3(p, uTime * 0.1));
      }

      mat2 rotate2d(float _angle) {
        return mat2(cos(_angle), -sin(_angle), sin(_angle), cos(_angle));
      }

      vec3 palette(float t) {
        vec3 a = vec3(0.5, 0.5, 0.5);
        vec3 b = uBaseColor;
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.263, 0.416, 0.557);

        return a + b * cos(6.28318 * (c * t + d));
      }

      vec3 effect() {
        vec2 uv = vUv;
        vec2 p = vec2(uv * uSize);
        p = rotate2d(noise2d(p)) * p;
        float n = noise(vec3(p, uTime * uSpeed)) * uIntensity;

        vec3 color = palette(n);
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
        float spec = pow(max(dot(normal, lightDir), 0.0), 32.0);
        color += spec * uMetallic;

        float rim = 1.0 - abs(dot(vNormal, vec3(0, 0, 1)));
        color += rim * 0.3;

        return color;
      }

      void main() {
        vec3 color = effect();
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });

  const planet = new THREE.Mesh(planetGeometry, planetMaterial);
  planet.userData = {
    points: points,
    category: category,
    rotationSpeed: Math.random() * 0.01 + 0.001,
    rotationAxis: new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize(),
    material: planetMaterial,
  };
  planetGroup.add(planet);

  // Add category-specific "swag" with rippling shaders
  if (category === "common") {
    const particleCount = 5;
    const particleGeometry = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const theta = (i / particleCount) * Math.PI * 2;
      particlePositions[i * 3] = Math.cos(theta) * (size * 1.5);
      particlePositions[i * 3 + 1] = 0;
      particlePositions[i * 3 + 2] = Math.sin(theta) * (size * 1.5);
    }
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3)
    );

    const particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBaseColor: { value: baseColor },
        uSize: { value: 3.0 },
        uSpeed: { value: 0.5 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = vec2(gl_PointCoord.x, gl_PointCoord.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 5.0 * (300.0 / length((modelViewMatrix * vec4(position, 1.0)).xyz));
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uBaseColor;
        uniform float uSize;
        uniform float uSpeed;
        uniform float uIntensity;
        varying vec2 vUv;

        float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 perm(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

        float noise(vec3 p) {
          vec3 a = floor(p);
          vec3 d = p - a;
          d = d * d * (3.0 - 2.0 * d);

          vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
          vec4 k1 = perm(b.xyxy);
          vec4 k2 = perm(k1.xyxy + b.zzww);

          vec4 c = k2 + a.zzzz;
          vec4 k3 = perm(c);
          vec4 k4 = perm(c + 1.0);

          vec4 o1 = fract(k3 * (1.0 / 41.0));
          vec4 o2 = fract(k4 * (1.0 / 41.0));

          vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
          vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

          return o4.y * d.y + o4.x * (1.0 - d.y);
        }

        float noise2d(vec2 p) {
          return noise(vec3(p, uTime * 0.1));
        }

        mat2 rotate2d(float _angle) {
          return mat2(cos(_angle), -sin(_angle), sin(_angle), cos(_angle));
        }

        vec3 palette(float t) {
          vec3 a = vec3(0.5, 0.5, 0.5);
          vec3 b = uBaseColor;
          vec3 c = vec3(1.0, 1.0, 1.0);
          vec3 d = vec3(0.263, 0.416, 0.557);

          return a + b * cos(6.28318 * (c * t + d));
        }

        void main() {
          vec2 uv = vUv - vec2(0.5);
          float dist = length(uv);
          if (dist > 0.5) discard;

          vec2 p = vec2(vUv * uSize);
          p = rotate2d(noise2d(p)) * p;
          float n = noise(vec3(p, uTime * uSpeed)) * uIntensity;

          vec3 color = palette(n);
          float alpha = smoothstep(0.5, 0.2, dist);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    planetGroup.add(particles);
  } else if (category === "exotic") {
    const ringSize = size * 1.8;
    const ringGeometry = new THREE.RingGeometry(
      ringSize,
      ringSize + size / 3,
      32
    );

    const ringMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBaseColor: { value: baseColor },
        uSize: { value: 5.0 },
        uSpeed: { value: 0.3 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uBaseColor;
        uniform float uSize;
        uniform float uSpeed;
        uniform float uIntensity;
        varying vec2 vUv;

        float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 perm(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

        float noise(vec3 p) {
          vec3 a = floor(p);
          vec3 d = p - a;
          d = d * d * (3.0 - 2.0 * d);

          vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
          vec4 k1 = perm(b.xyxy);
          vec4 k2 = perm(k1.xyxy + b.zzww);

          vec4 c = k2 + a.zzzz;
          vec4 k3 = perm(c);
          vec4 k4 = perm(c + 1.0);

          vec4 o1 = fract(k3 * (1.0 / 41.0));
          vec4 o2 = fract(k4 * (1.0 / 41.0));

          vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
          vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

          return o4.y * d.y + o4.x * (1.0 - d.y);
        }

        float noise2d(vec2 p) {
          return noise(vec3(p, uTime * 0.1));
        }

        mat2 rotate2d(float _angle) {
          return mat2(cos(_angle), -sin(_angle), sin(_angle), cos(_angle));
        }

        vec3 palette(float t) {
          vec3 a = vec3(0.5, 0.5, 0.5);
          vec3 b = uBaseColor;
          vec3 c = vec3(1.0, 1.0, 1.0);
          vec3 d = vec3(0.263, 0.416, 0.557);

          return a + b * cos(6.28318 * (c * t + d));
        }

        void main() {
          vec2 uv = vUv;
          vec2 p = vec2(uv * uSize);
          p = rotate2d(noise2d(p)) * p;
          float n = noise(vec3(p, uTime * uSpeed)) * uIntensity;

          vec3 color = palette(n);
          gl_FragColor = vec4(color, 0.7);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    planetGroup.add(ring);
  } else if (category === "rare") {
    const glowSize = size * 1.3;
    const glowGeometry = new THREE.SphereGeometry(glowSize, 32, 32);

    const glowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBaseColor: { value: baseColor },
        uSize: { value: 3.0 },
        uSpeed: { value: 0.4 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uBaseColor;
        uniform float uSize;
        uniform float uSpeed;
        uniform float uIntensity;
        varying vec2 vUv;

        float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 perm(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

        float noise(vec3 p) {
          vec3 a = floor(p);
          vec3 d = p - a;
          d = d * d * (3.0 - 2.0 * d);

          vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
          vec4 k1 = perm(b.xyxy);
          vec4 k2 = perm(k1.xyxy + b.zzww);

          vec4 c = k2 + a.zzzz;
          vec4 k3 = perm(c);
          vec4 k4 = perm(c + 1.0);

          vec4 o1 = fract(k3 * (1.0 / 41.0));
          vec4 o2 = fract(k4 * (1.0 / 41.0));

          vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
          vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

          return o4.y * d.y + o4.x * (1.0 - d.y);
        }

        float noise2d(vec2 p) {
          return noise(vec3(p, uTime * 0.1));
        }

        mat2 rotate2d(float _angle) {
          return mat2(cos(_angle), -sin(_angle), sin(_angle), cos(_angle));
        }

        vec3 palette(float t) {
          vec3 a = vec3(0.5, 0.5, 0.5);
          vec3 b = uBaseColor;
          vec3 c = vec3(1.0, 1.0, 1.0);
          vec3 d = vec3(0.263, 0.416, 0.557);

          return a + b * cos(6.28318 * (c * t + d));
        }

        void main() {
          vec2 uv = vUv;
          vec2 p = vec2(uv * uSize);
          p = rotate2d(noise2d(p)) * p;
          float n = noise(vec3(p, uTime * uSpeed)) * uIntensity;

          vec3 color = palette(n);
          gl_FragColor = vec4(color, 0.3);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    });

    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    planetGroup.add(glow);

    const moonCount = 2;
    for (let i = 0; i < moonCount; i++) {
      const moonSize = size * 0.3;
      const moonGeometry = new THREE.SphereGeometry(moonSize, 16, 16);

      const moonMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uBaseColor: { value: baseColor },
          uSize: { value: 3.0 },
          uSpeed: { value: 0.5 },
          uIntensity: { value: 1.0 },
          uMetallic: { value: 0.8 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          void main() {
            vUv = uv;
            vNormal = normal;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uBaseColor;
          uniform float uSize;
          uniform float uSpeed;
          uniform float uIntensity;
          uniform float uMetallic;
          varying vec2 vUv;
          varying vec3 vNormal;

          float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 perm(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }

          float noise(vec3 p) {
            vec3 a = floor(p);
            vec3 d = p - a;
            d = d * d * (3.0 - 2.0 * d);

            vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
            vec4 k1 = perm(b.xyxy);
            vec4 k2 = perm(k1.xyxy + b.zzww);

            vec4 c = k2 + a.zzzz;
            vec4 k3 = perm(c);
            vec4 k4 = perm(c + 1.0);

            vec4 o1 = fract(k3 * (1.0 / 41.0));
            vec4 o2 = fract(k4 * (1.0 / 41.0));

            vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
            vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

            return o4.y * d.y + o4.x * (1.0 - d.y);
          }

          float noise2d(vec2 p) {
            return noise(vec3(p, uTime * 0.1));
          }

          mat2 rotate2d(float _angle) {
            return mat2(cos(_angle), -sin(_angle), sin(_angle), cos(_angle));
          }

          vec3 palette(float t) {
            vec3 a = vec3(0.5, 0.5, 0.5);
            vec3 b = uBaseColor;
            vec3 c = vec3(1.0, 1.0, 1.0);
            vec3 d = vec3(0.263, 0.416, 0.557);

            return a + b * cos(6.28318 * (c * t + d));
          }

          vec3 effect() {
            vec2 uv = vUv;
            vec2 p = vec2(uv * uSize);
            p = rotate2d(noise2d(p)) * p;
            float n = noise(vec3(p, uTime * uSpeed)) * uIntensity;

            vec3 color = palette(n);
            vec3 normal = normalize(vNormal);
            vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
            float spec = pow(max(dot(normal, lightDir), 0.0), 32.0);
            color += spec * uMetallic;

            float rim = 1.0 - abs(dot(vNormal, vec3(0, 0, 1)));
            color += rim * 0.3;

            return color;
          }

          void main() {
            vec3 color = effect();
            gl_FragColor = vec4(color, 0.8);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
      });

      const moon = new THREE.Mesh(moonGeometry, moonMaterial);
      moon.position.set(
        Math.cos((i / moonCount) * Math.PI * 2) * (size * 2),
        0,
        Math.sin((i / moonCount) * Math.PI * 2) * (size * 2)
      );
      planetGroup.add(moon);
    }
  }

  planetGroup.position.set(x, y, z);
  scene.add(planetGroup);
  planets.push(planetGroup);
}

function createStarryBackground() {
  // Static Stars (unchanged)
  const staticStarsGeometry = new THREE.BufferGeometry();
  const staticPositions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    staticPositions[i * 3] = (Math.random() - 0.5) * 6000;
    staticPositions[i * 3 + 1] = (Math.random() - 0.5) * 6000;
    staticPositions[i * 3 + 2] = (Math.random() - 0.5) * 6000;
  }
  staticStarsGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(staticPositions, 3)
  );
  const staticStarsMaterial = new THREE.PointsMaterial({
    size: 2,
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
  });
  const staticStars = new THREE.Points(
    staticStarsGeometry,
    staticStarsMaterial
  );
  scene.add(staticStars);

  // Twinkling Stars (unchanged)
  const twinkleStarsGeometry = new THREE.BufferGeometry();
  const twinklePositions = new Float32Array(STAR_COUNT * 6);
  const twinkleColors = new Float32Array(STAR_COUNT * 6);
  for (let i = 0; i < STAR_COUNT; i++) {
    twinklePositions[i * 3] = (Math.random() - 0.5) * 6000;
    twinklePositions[i * 3 + 1] = (Math.random() - 0.5) * 6000;
    twinklePositions[i * 3 + 2] = (Math.random() - 0.5) * 6000;
    twinkleColors[i * 3] = 1;
    twinkleColors[i * 3 + 1] = 1;
    twinkleColors[i * 3 + 2] = 1;
  }
  twinkleStarsGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(twinklePositions, 3)
  );
  twinkleStarsGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(twinkleColors, 3)
  );
  const twinkleStarsMaterial = new THREE.PointsMaterial({
    size: 3,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const twinkleStars = new THREE.Points(
    twinkleStarsGeometry,
    twinkleStarsMaterial
  );
  scene.add(twinkleStars);

  // Enhanced Nebula with Fluid Effect
  const nebulaGeometry = new THREE.SphereGeometry(4000, 64, 64);
  const nebulaMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(0x1e0033) },
      uColor2: { value: new THREE.Color(0x003366) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec3 vPosition;

      float noise(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(100.0);
        for (int i = 0; i < 4; ++i) {
          v += a * noise(p);
          p = p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 uv = vPosition / 4000.0 + vec3(uTime * 0.01);
        float n = fbm(uv * 2.0);
        vec3 color = mix(uColor1, uColor2, n);
        float alpha = smoothstep(0.1, 0.6, n) * 0.3;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  const nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
  scene.add(nebula);

  function updateBackground() {
    nebula.material.uniforms.uTime.value += 0.016;
    twinkleStarsMaterial.size = 3 + Math.sin(gameTime * 3) * 0.5;
    requestAnimationFrame(updateBackground);
  }
  updateBackground();
}

let platforms = [];

function createPlatforms() {
  const platformCount = 5;
  const platformGeometry = new THREE.BoxGeometry(200, 100, 200);

  const platformMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(0x00ff99) }, // Green
      uColor2: { value: new THREE.Color(0x0033ff) }, // Blue
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec2 vUv;

      float noise(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(100.0);
        for (int i = 0; i < 4; ++i) {
          v += a * noise(p);
          p = p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        uv += vec2(uTime * 0.1, uTime * 0.05); // Slow flow

        // Fluid turbulence
        vec3 p = vec3(uv * 3.0, uTime * 0.2);
        float n = fbm(p);
        float glow = smoothstep(0.3, 0.7, n);

        // Color swirl
        vec3 color = mix(uColor1, uColor2, n);
        color += vec3(1.0) * glow * 0.5;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });

  for (let i = 0; i < platformCount; i++) {
    const platform = new THREE.Mesh(platformGeometry, platformMaterial);
    platform.position.set(
      (Math.random() - 0.5) * (CUBE_SIZE - 50),
      (Math.random() - 0.5) * (CUBE_SIZE - 50),
      (Math.random() - 0.5) * (CUBE_SIZE - 50)
    );
    scene.add(platform);
    platforms.push(platform);
  }
}

function updatePlatforms() {
  platforms.forEach((platform) => {
    platform.material.uniforms.uTime.value += 0.016;
  });
}

function initAvatarLighting() {
  // Clear any existing lights
  avatar.children = avatar.children.filter(
    (child) => !(child instanceof THREE.Light)
  );

  // Front spotlight
  const frontLight = new THREE.SpotLight(0xffffff, 3, 50, Math.PI / 6);
  frontLight.position.set(0, 5, 15);
  frontLight.target = avatar;
  avatar.add(frontLight);

  // Back spotlight
  const backLight = new THREE.SpotLight(0xffffff, 2, 50, Math.PI / 4);
  backLight.position.set(0, 5, -15);
  backLight.target = avatar;
  avatar.add(backLight);

  // Top spotlight
  const topLight = new THREE.SpotLight(0xffffff, 1.5, 50, Math.PI / 3);
  topLight.position.set(0, 20, 0);
  topLight.target = avatar;
  avatar.add(topLight);

  // Point light for ambient fill
  const pointLight = new THREE.PointLight(0xffffff, 1, 20);
  pointLight.position.set(0, 5, 0);
  avatar.add(pointLight);
}

function setupUI() {
  // Setup game over element
  const gameOverElement = document.createElement("div");
  gameOverElement.style.position = "absolute";
  gameOverElement.style.top = "50%";
  gameOverElement.style.left = "50%";
  gameOverElement.style.transform = "translate(-50%, -50%)";
  gameOverElement.style.color = "white";
  gameOverElement.style.fontSize = "48px";
  gameOverElement.style.fontFamily = "Arial";
  gameOverElement.style.display = "none";
  document.body.appendChild(gameOverElement);
}

// code for portal

// ====================================
// EVENT HANDLERS
// ====================================
function setupEventListeners() {
  // Keyboard controls
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  // Mouse controls
  document.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousemove", handleMouseMove);

  // Window resize
  window.addEventListener("resize", handleResize);
}

function handleKeyDown(e) {
  if (e.key === "w") controls.forward = true;
  if (e.key === "s") controls.backward = true;
  if (e.key === "a") controls.rotateLeft = true;
  if (e.key === "d") controls.rotateRight = true;
  if (e.key === "q") controls.up = true;
  if (e.key === "e") controls.down = true;
  if (e.key === "j") controls.cameraLeft = true;
  if (e.key === "l") controls.cameraRight = true;
  if (e.key === "i") controls.cameraUp = true;
  if (e.key === "k") controls.cameraDown = true;
}

function handleKeyUp(e) {
  if (e.key === "w") controls.forward = false;
  if (e.key === "s") controls.backward = false;
  if (e.key === "a") controls.rotateLeft = false;
  if (e.key === "d") controls.rotateRight = false;
  if (e.key === "q") controls.up = false;
  if (e.key === "e") controls.down = false;
  if (e.key === "j") controls.cameraLeft = false;
  if (e.key === "l") controls.cameraRight = false;
  if (e.key === "i") controls.cameraUp = false;
  if (e.key === "k") controls.cameraDown = false;
}

function handleMouseDown(e) {
  if (!laserActive && cooldownTime <= 0) {
    laserActive = true;
    laserTime = 0;
    createEnhancedLaserBeam(e.clientX, e.clientY);
  }
}

function handleMouseUp() {
  // We don't end the laser on mouseup anymore - it stays for 5 seconds
  if (laserActive) {
    laserActive = false;
    scene.remove(laser);
    laser = null;
    cooldownTime = 0;
  }
}

function handleMouseMove(e) {
  // Update crosshair position
  const crosshair = document.getElementById("crosshair");
  crosshair.style.left = `${e.clientX - 10}px`; // Center the crosshair
  crosshair.style.top = `${e.clientY - 10}px`; // Center the crosshair

  // Update laser direction if active
  if (laserActive && laser) {
    createEnhancedLaserBeam(e.clientX, e.clientY);
  }
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function createEnhancedLaserBeam(mouseX, mouseY) {
  mouse.x = (mouseX / window.innerWidth) * 2 - 1;
  mouse.y = -(mouseY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const direction = raycaster.ray.direction.clone();
  const laserStart = avatarHead.position.clone();
  const laserEnd = laserStart.clone().add(direction.multiplyScalar(1000));

  if (laser) scene.remove(laser);

  const laserGeometry = new THREE.CylinderGeometry(
    0.45,
    0.45,
    laserStart.distanceTo(laserEnd),
    16
  );
  laserGeometry.rotateX(Math.PI / 2);

  const laserMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color(0x66ccff) }, // Light blue
      uColor2: { value: new THREE.Color(0xff99ff) }, // Pinkish-purple
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec2 vUv;

      float noise(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }

      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(100.0);
        for (int i = 0; i < 4; ++i) {
          v += a * noise(p);
          p = p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        uv.y += uTime * 2.0; // Flow along the beam
        uv.x += sin(uv.y * 3.0 + uTime) * 0.1; // Swirl

        // Fluid-like turbulence
        vec3 p = vec3(uv * 5.0, uTime * 0.5);
        float n = fbm(p);
        float glow = 1.0 - smoothstep(0.0, 0.2, abs(uv.x - 0.5));

        // Color with fluid motion
        vec3 color = mix(uColor1, uColor2, n);
        color += vec3(1.0) * n * 0.3; // Glow boost

        gl_FragColor = vec4(color, glow * (0.8 + n * 0.2));
      }
    `,
    transparent: false,
    blending: THREE.AdditiveBlending,
  });

  laser = new THREE.Mesh(laserGeometry, laserMaterial);
  const midpoint = laserStart.clone().add(laserEnd).multiplyScalar(0.5);
  laser.position.copy(midpoint);
  laser.lookAt(laserEnd);
  laser.userData = {
    direction: direction.normalize(),
    origin: laserStart.clone(),
  };
  scene.add(laser);

  // Add glow layer
  const glowGeometry = new THREE.CylinderGeometry(
    0.8,
    0.8,
    laserStart.distanceTo(laserEnd),
    16
  );
  glowGeometry.rotateX(Math.PI / 2);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.copy(midpoint);
  glow.lookAt(laserEnd);
  scene.add(glow);

  function animateLaser() {
    if (laser) {
      laser.material.uniforms.uTime.value += 0.016;
      glow.material.opacity = 0.3 + Math.sin(gameTime * 5) * 0.1;
      requestAnimationFrame(animateLaser);
    } else {
      scene.remove(glow);
    }
  }
  animateLaser();

  return laser;
}

function endGame() {
  gameOver = true;
  laserActive = false;
  if (laser) {
    scene.remove(laser);
    if (laser.userData.glow) scene.remove(laser.userData.glow);
    laser = null;
  }

  const gameOverScreen = document.createElement("div");
  gameOverScreen.id = "game-over";
  gameOverScreen.innerHTML = `
    <div class="game-over-content">
      <h1 class="glowy-text">Game Over!</h1>
      <p class="glowy-text">Final Score: ${score || 0}</p>
      <button id="restart-button" class="glowy-button">Restart</button>
    </div>
  `;
  document.body.appendChild(gameOverScreen);

  document.getElementById("restart-button").addEventListener("click", () => {
    // Reset game state
    gameOver = false;
    gameTime = 0;
    score = 0;
    laserActive = false;
    cooldownTime = 0;
    laserTime = 0;
    if (laser) {
      scene.remove(laser);
      if (laser.userData.glow) scene.remove(laser.userData.glow);
      laser = null;
    }
    // Reset avatar position (if applicable)
    if (avatar) {
      avatar.position.set(0, 0, 0);
    }
    // Reset planets
    planets.forEach((planetGroup) => scene.remove(planetGroup));
    planets = [];
    createPlanets();
    document.getElementById("score").textContent = `Score: ${score}`;
    document.getElementById("timer").textContent = `Time: 05:00`;
    gameOverScreen.remove();

    // Restart the animation loop
    animate();
  });
}

function createExplosion(position, color, category) {
  const cometCount = category === "rare" ? 15 : category === "exotic" ? 12 : 10;
  const comets = [];

  for (let i = 0; i < cometCount; i++) {
    const cometGeometry = new THREE.SphereGeometry(0.5, 8, 8); // Very small
    const cometMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
    });
    const comet = new THREE.Mesh(cometGeometry, cometMaterial);
    comet.position.copy(position);
    scene.add(comet);
    comets.push({
      mesh: comet,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      ),
      targetOffset: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2
      ),
    });
  }

  let time = 0;
  const scatterDuration = 0.3;
  const travelDuration = 1.8;

  function animateComets() {
    time += 0.016;

    if (time < scatterDuration) {
      comets.forEach((comet) => {
        comet.mesh.position.add(comet.velocity);
      });
    } else if (time < scatterDuration + travelDuration) {
      const progress = (time - scatterDuration) / travelDuration;
      const easedProgress = 1 - Math.pow(1 - progress, 4);
      const avatarCenter = avatar.position.clone();

      comets.forEach((comet) => {
        const targetPos = avatarCenter.clone().add(comet.targetOffset);
        comet.mesh.position.lerpVectors(
          comet.mesh.position,
          targetPos,
          easedProgress * 0.15
        );
        const distance = comet.mesh.position.distanceTo(avatarCenter);
        comet.mesh.material.opacity = distance < 2 ? distance / 2 : 1;
        if (distance < 1) {
          // Sparkle inside avatar
          createSparkle(comet.mesh.position, color);
          scene.remove(comet.mesh);
          comets.splice(comets.indexOf(comet), 1);
        }
      });
    } else {
      comets.forEach((comet) => scene.remove(comet.mesh));
      return;
    }

    requestAnimationFrame(animateComets);
  }
  animateComets();
}

let cosmicParticles;

function createCosmicParticles() {
  const particleCount = 1000; // More particles for density
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * CUBE_SIZE;
    particlePositions[i * 3 + 1] = (Math.random() - 0.5) * CUBE_SIZE;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * CUBE_SIZE;
    particleColors[i * 3] = Math.random() > 0.5 ? 0.4 : 1.0; // Cyan/white mix
    particleColors[i * 3 + 1] = Math.random();
    particleColors[i * 3 + 2] = 1.0;
  }

  particleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePositions, 3)
  );
  particleGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(particleColors, 3)
  );

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute vec3 color; // Declare color attribute
      varying vec3 vColor;
      uniform float uTime;
      void main() {
        vColor = color;
        vec3 pos = position;
        pos += vec3(
          sin(uTime * 0.5 + position.x * 0.1),
          cos(uTime * 0.5 + position.y * 0.1),
          sin(uTime * 0.5 + position.z * 0.1)
        ) * 5.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = 2.0 * (300.0 / length((modelViewMatrix * vec4(pos, 1.0)).xyz));
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float dist = length(uv);
        if (dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.2, dist);
        gl_FragColor = vec4(vColor, alpha * 0.7);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  cosmicParticles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(cosmicParticles);
}

function updateCosmicParticles() {
  if (!cosmicParticles) return;
  cosmicParticles.material.uniforms.uTime.value += 0.016;
}

function createSparkle(position, color) {
  const sparkleGeometry = new THREE.BufferGeometry();
  const sparklePositions = new Float32Array(10 * 3);
  for (let i = 0; i < 10; i++) {
    sparklePositions[i * 3] = position.x;
    sparklePositions[i * 3 + 1] = position.y;
    sparklePositions[i * 3 + 2] = position.z;
  }
  sparkleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(sparklePositions, 3)
  );
  const sparkleMaterial = new THREE.PointsMaterial({
    size: 2,
    color: color,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const sparkle = new THREE.Points(sparkleGeometry, sparkleMaterial);
  scene.add(sparkle);

  let sparkleTime = 0;
  function animateSparkle() {
    sparkleTime += 0.016;
    const pos = sparkle.geometry.attributes.position.array;
    for (let i = 0; i < 10; i++) {
      pos[i * 3] += (Math.random() - 0.5) * 2;
      pos[i * 3 + 1] += (Math.random() - 0.5) * 2;
      pos[i * 3 + 2] += (Math.random() - 0.5) * 2;
    }
    sparkle.geometry.attributes.position.needsUpdate = true;
    sparkle.material.opacity = 1 - sparkleTime / 0.5;
    if (sparkleTime < 0.5) requestAnimationFrame(animateSparkle);
    else scene.remove(sparkle);
  }
  animateSparkle();
}

// ====================================
// GAME LOOP AND UPDATE FUNCTIONS
// ====================================

function animate() {
  if (gameOver) return;
  requestAnimationFrame(animate);
  updateGameTime();
  updateAvatarMovement();
  //   updateAvatarTrail();
  updateCamera();
  updateLaser();
  updatePlanets();
  updatePlatforms();
  updateCosmicParticles();
  renderer.render(scene, camera);
}

setTimeout(() => {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.remove();
  }
}, 3000); // Remove after 5 seconds

function updateGameTime() {
  if (gameOver) return;

  gameTime += 1 / 60; // Assuming 60 FPS
  const remainingTime = Math.max(0, GAME_DURATION - gameTime);
  const minutes = Math.floor(remainingTime / 60);
  const seconds = Math.floor(remainingTime % 60);
  document.getElementById("timer").textContent = `Time: ${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // Check for game over
  if (remainingTime <= 0) {
    endGame();
  }
}

function updateAvatarMovement() {
  if (!avatar || !avatarHead) return;

  // Avatar rotation
  if (controls.rotateLeft) avatar.rotation.y += AVATAR_ROTATION_SPEED;
  if (controls.rotateRight) avatar.rotation.y -= AVATAR_ROTATION_SPEED;

  // Avatar movement
  if (controls.forward) {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      avatar.quaternion
    );
    avatar.position.x -= direction.x * AVATAR_MOVEMENT_SPEED;
    avatar.position.z -= direction.z * AVATAR_MOVEMENT_SPEED;
  }
  if (controls.backward) {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      avatar.quaternion
    );
    avatar.position.x += direction.x * AVATAR_MOVEMENT_SPEED;
    avatar.position.z += direction.z * AVATAR_MOVEMENT_SPEED;
  }
  if (controls.up) avatar.position.y += AVATAR_MOVEMENT_SPEED;
  if (controls.down) avatar.position.y -= AVATAR_MOVEMENT_SPEED;

  // Update lights
  const frontLight = avatar.children.find(
    (child) => child instanceof THREE.SpotLight && child.position.z > 0
  );
  const backLight = avatar.children.find(
    (child) => child instanceof THREE.SpotLight && child.position.z < 0
  );
  if (frontLight) frontLight.position.set(0, 5, 10);
  if (backLight) backLight.position.set(0, 5, -10);
  // Clamp position to cube
  const halfSize = CUBE_SIZE / 2;
  avatar.position.x = Math.max(
    -halfSize,
    Math.min(halfSize, avatar.position.x)
  );
  avatar.position.y = Math.max(
    -halfSize,
    Math.min(halfSize, avatar.position.y)
  );
  avatar.position.z = Math.max(
    -halfSize,
    Math.min(halfSize, avatar.position.z)
  );

  // Update head position to follow avatar
  avatarHead.position.x = avatar.position.x;
  avatarHead.position.y = avatar.position.y + 3;
  avatarHead.position.z = avatar.position.z;
  avatarHead.rotation.copy(avatar.rotation);
}

function updateCamera() {
  if (!avatar) return;

  // Update camera angle based on controls
  if (controls.cameraLeft)
    cameraAngleY = Math.min(MAX_Y_ROTATION, cameraAngleY + ROTATION_SPEED);
  if (controls.cameraRight)
    cameraAngleY = Math.max(-MAX_Y_ROTATION, cameraAngleY - ROTATION_SPEED);
  if (controls.cameraUp)
    cameraAngleX = Math.min(MAX_X_ROTATION, cameraAngleX + ROTATION_SPEED);
  if (controls.cameraDown)
    cameraAngleX = Math.max(-MAX_X_ROTATION, cameraAngleX - ROTATION_SPEED);

  // Auto-return to center when no keys pressed
  if (!controls.cameraLeft && !controls.cameraRight) {
    cameraAngleY *= 1 - CAMERA_RETURN_SPEED; // Dampen horizontal rotation
  }
  if (!controls.cameraUp && !controls.cameraDown) {
    cameraAngleX *= 1 - CAMERA_RETURN_SPEED; // Dampen vertical rotation
  }

  // Calculate camera position
  const cameraOffset = new THREE.Vector3(
    Math.sin(cameraAngleY) * cameraDistance,
    10 + cameraAngleX * 10,
    Math.cos(cameraAngleY) * cameraDistance
  );

  // Calculate rotated offset vector
  const rotatedOffset = cameraOffset.clone().applyQuaternion(avatar.quaternion);
  camera.position.copy(avatar.position).add(rotatedOffset);

  // Update point light position
  pointLight.position.copy(avatar.position).add(new THREE.Vector3(0, 10, 10));

  // Make the camera look at a point slightly ahead of the avatar
  const cameraTarget = avatar.position.clone();
  cameraTarget.y += 2; // Look slightly above the avatar
  camera.lookAt(cameraTarget);
}

function updatePlanets() {
  // Animate planets and their effects
  planets.forEach((planetGroup) => {
    const planet = planetGroup.children[0];
    planet.material.uniforms.uTime.value += 0.016;

    if (planet.userData.rotationSpeed) {
      const rotationAxis = planet.userData.rotationAxis;
      const rotationSpeed = planet.userData.rotationSpeed;
      planetGroup.rotateOnAxis(rotationAxis, rotationSpeed);
    }

    if (planet.userData.category === "common") {
      const particles = planetGroup.children[1];
      particles.material.uniforms.uTime.value += 0.016;
      particles.rotation.y += 0.02;
    } else if (planet.userData.category === "exotic") {
      const ring = planetGroup.children[1];
      ring.material.uniforms.uTime.value += 0.016;
    } else if (planet.userData.category === "rare") {
      const glow = planetGroup.children[1];
      glow.material.uniforms.uTime.value += 0.016;
      glow.material.opacity = 0.3 + Math.sin(gameTime * 2) * 0.1;
      for (let i = 2; i < planetGroup.children.length; i++) {
        const moon = planetGroup.children[i];
        moon.material.uniforms.uTime.value += 0.016;
        moon.rotation.y += 0.05;
      }
    }
  });

  // Respawn planets to maintain 40 common, 40 exotic, 20 rare (total 100)
  const commonCount = planets.filter(
    (p) => p.children[0].userData.category === "common"
  ).length;
  const exoticCount = planets.filter(
    (p) => p.children[0].userData.category === "exotic"
  ).length;
  const rareCount = planets.filter(
    (p) => p.children[0].userData.category === "rare"
  ).length;

  if (planets.length < 100) {
    const toAdd = Math.min(100 - planets.length, 5);
    for (let i = 0; i < toAdd; i++) {
      if (commonCount < 40) {
        createSinglePlanet("common");
      } else if (exoticCount < 40) {
        createSinglePlanet("exotic");
      } else if (rareCount < 20) {
        createSinglePlanet("rare");
      }
    }
  }
  if (planets.length > 100) {
    const toRemove = planets.length - 100;
    for (let i = 0; i < toRemove; i++) {
      const planetGroup = planets[0];
      scene.remove(planetGroup);
      planets.shift();
    }
  }
}

function updateLaser() {
  if (!avatar || !avatarHead) return;

  if (laserActive) {
    laserTime += 1 / 60;

    if (laser) {
      const rayOrigin = avatarHead.position.clone();
      const rayDirection = laser.userData.direction.clone();
      const laserEnd = rayOrigin.clone().add(rayDirection.multiplyScalar(1000));
      const midpoint = rayOrigin.clone().add(laserEnd).multiplyScalar(0.5);
      laser.position.copy(midpoint);
      laser.lookAt(laserEnd);
      laser.userData.origin = rayOrigin;

      if (laser.userData.glow) {
        laser.userData.glow.position.copy(midpoint);
        laser.userData.glow.lookAt(laserEnd);
      }
    }

    if (laser) {
      const rayOrigin = avatarHead.position.clone();
      const rayDirection = laser.userData.direction.clone();

      const laserRaycaster = new THREE.Raycaster(rayOrigin, rayDirection);
      const intersects = laserRaycaster.intersectObjects(planets);

      if (intersects.length > 0) {
        const planetGroup = intersects[0].object.parent;
        const planet = intersects[0].object;
        // Use a fallback for points if undefined
        const points =
          planet.userData.points ??
          (planet.userData.category === "rare"
            ? 30
            : planet.userData.category === "exotic"
            ? 20
            : 10);
        score = (score || 0) + points; // Ensure score is a number
        document.getElementById("score").textContent = `Score: ${score}`;
        showPointsPopup(points, planet.userData.category);
        scene.remove(planetGroup);
        planets.splice(planets.indexOf(planetGroup), 1);
        const explosionColor =
          planet.userData.material.uniforms?.uBaseColor.value;
        createExplosion(
          planetGroup.position,
          explosionColor,
          planet.userData.category
        );
      }
    }

    if (laserTime >= LASER_MAX_DURATION) {
      laserActive = false;
      scene.remove(laser);
      if (laser.userData.glow) scene.remove(laser.userData.glow);
      laser = null;
      cooldownTime = LASER_COOLDOWN_DURATION;
    }
  } else if (cooldownTime > 0) {
    cooldownTime -= 1 / 60;
  }
}

function showPointsPopup(points, category) {
  const popup = document.createElement("div");
  popup.className = "points-popup";
  popup.textContent =
    category === "rare"
      ? `+${points} RARE!`
      : category === "exotic"
      ? `+${points} Exotic`
      : `+${points}`;
  popup.style.color =
    category === "rare"
      ? "#ff00ff"
      : category === "exotic"
      ? "#ffaa00"
      : "#ffffff";
  popup.style.left = `${
    Math.random() * window.innerWidth * 0.8 + window.innerWidth * 0.1
  }px`;
  popup.style.top = `${
    Math.random() * window.innerHeight * 0.8 + window.innerHeight * 0.1
  }px`;
  document.getElementById("ui").appendChild(popup);

  setTimeout(() => popup.remove(), 1000);
}

// ====================================
// INITIALIZATION AND STARTUP
// ====================================
function init() {
  initScene();
  createPlayableCube();
  createPlanets();
  createStarryBackground();
  // createPlatforms();
  createCosmicParticles();

  setupUI();
  setupEventListeners();
  loadAvatar(); // This will start the animation loop once avatar is loaded
}

// Start the game
init();
