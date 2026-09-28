import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6ca8c9);
scene.fog = new THREE.Fog(0x8db8c9, 62, 150);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(180, 48, 28),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x245a87) },
      horizonColor: { value: new THREE.Color(0x8ec6d5) },
      bottomColor: { value: new THREE.Color(0xd8c792) }
    },
    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPosition;

      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 color = mix(horizonColor, topColor, smoothstep(0.05, 0.75, h));
        color = mix(bottomColor, color, smoothstep(-0.35, 0.12, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `
  })
);
scene.add(sky);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
camera.position.set(0, 42, 50);
camera.lookAt(0, 0, 0);

const ambient = new THREE.HemisphereLight(0xb9ddff, 0x24300d, 2.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff0c4, 5);
sun.position.set(-24, 44, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const worldSize = 82;
const halfWorld = worldSize / 2;
const terrainPatches = [];
const emitters = [];
const props = [];
const fields = [];
const lakes = [];
const vehicles = [];
const keys = new Set();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const pointerTarget = new THREE.Vector3();
const healthyColor = new THREE.Color(0x4e904a);
const dryColor = new THREE.Color(0xc7954e);
const burnedColor = new THREE.Color(0x6f3c2b);

const burnCanvas = document.createElement('canvas');
burnCanvas.width = 1024;
burnCanvas.height = 1024;
const burnContext = burnCanvas.getContext('2d');
burnContext.clearRect(0, 0, burnCanvas.width, burnCanvas.height);

const burnTexture = new THREE.CanvasTexture(burnCanvas);
burnTexture.colorSpace = THREE.SRGBColorSpace;
burnTexture.minFilter = THREE.LinearFilter;
burnTexture.magFilter = THREE.LinearFilter;

const burnPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(worldSize, worldSize),
  new THREE.MeshBasicMaterial({
    map: burnTexture,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  })
);

burnPlane.rotation.x = -Math.PI / 2;
burnPlane.position.y = 0.09;
world.add(burnPlane);

let pointerActive = false;

const state = {
  holeRadius: 4.4,
  uvRadius: 6.8,
  uvIntensity: 0.18,
  score: 0,
  totalDamage: 0,
  emittersDestroyed: 0,
  gameTime: 0,
  combo: 1,
  comboTimer: 0,
  stage: 1,
  flareActive: false,
  flareTimer: 0,
  nextFlareAt: 28,
  finished: false
};

const groundGeometry = new THREE.PlaneGeometry(worldSize, worldSize, 34, 34);
groundGeometry.rotateX(-Math.PI / 2);

const groundPosition = groundGeometry.attributes.position;

for (let i = 0; i < groundPosition.count; i += 1) {
  const x = groundPosition.getX(i);
  const z = groundPosition.getZ(i);
  const distance = Math.hypot(x, z);
  const height =
    Math.sin(x * 0.22) * 0.35 +
    Math.cos(z * 0.18) * 0.3 +
    Math.sin((x + z) * 0.11) * 0.28;

  groundPosition.setY(i, height * Math.max(0.15, 1 - distance / 80));
}

groundPosition.needsUpdate = true;
groundGeometry.computeVertexNormals();

const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x3f7f44,
  roughness: 0.94,
  metalness: 0.02
});

const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.receiveShadow = true;
world.add(ground);

const roadMaterial = new THREE.MeshStandardMaterial({
  color: 0x485057,
  roughness: 0.96,
  metalness: 0.02
});

const roadLineMaterial = new THREE.MeshBasicMaterial({
  color: 0xd8d2ad,
  transparent: true,
  opacity: 0.42
});

function createRoad(x, z, width, depth, horizontal = true) {
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.08, depth),
    roadMaterial
  );

  road.position.set(x, 0.08, z);
  road.receiveShadow = true;
  world.add(road);

  const stripeCount = horizontal
    ? Math.max(2, Math.floor(width / 4))
    : Math.max(2, Math.floor(depth / 4));

  for (let i = 0; i < stripeCount; i += 1) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(
        horizontal ? 1.2 : 0.08,
        0.02,
        horizontal ? 0.08 : 1.2
      ),
      roadLineMaterial
    );

    const t = stripeCount === 1 ? 0.5 : i / (stripeCount - 1);

    stripe.position.set(
      horizontal ? x - width * 0.42 + t * width * 0.84 : x,
      0.14,
      horizontal ? z : z - depth * 0.42 + t * depth * 0.84
    );

    world.add(stripe);
  }
}

[
  [0, -18, 72, 3.2, true],
  [0, 2, 72, 3.6, true],
  [0, 20, 72, 3.2, true],
  [-22, 0, 3.2, 72, false],
  [0, 0, 3.6, 72, false],
  [23, 0, 3.2, 72, false]
].forEach((data) => createRoad(...data));

function createVehicle(route, offset, speed, color) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.42, 0.58),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.58,
      metalness: 0.18
    })
  );

  body.position.y = 0.32;
  body.castShadow = true;

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.3, 0.48),
    new THREE.MeshStandardMaterial({
      color: 0xc7d8de,
      roughness: 0.35,
      metalness: 0.08
    })
  );

  cabin.position.set(-0.08, 0.63, 0);
  cabin.castShadow = true;

  group.add(body, cabin);
  group.position.y = 0.2;

  group.userData.route = route;
  group.userData.t = offset;
  group.userData.speed = speed;
  group.userData.baseSpeed = speed;
  group.userData.evacuating = false;
  group.userData.disabled = false;

  vehicles.push(group);
  world.add(group);
}

const trafficRoutes = [
  { axis: 'x', fixed: -18, min: -35, max: 35, dir: 1 },
  { axis: 'x', fixed: -18, min: -35, max: 35, dir: -1 },
  { axis: 'x', fixed: 2, min: -35, max: 35, dir: 1 },
  { axis: 'x', fixed: 20, min: -35, max: 35, dir: -1 },
  { axis: 'z', fixed: -22, min: -35, max: 35, dir: 1 },
  { axis: 'z', fixed: 0, min: -35, max: 35, dir: -1 },
  { axis: 'z', fixed: 23, min: -35, max: 35, dir: 1 }
];

for (let i = 0; i < 18; i += 1) {
  createVehicle(
    trafficRoutes[i % trafficRoutes.length],
    Math.random(),
    randomRange(3.5, 6.4),
    new THREE.Color().setHSL(Math.random(), 0.55, 0.52)
  );
}


function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function createPatch(x, z, size) {
  const geometry = new THREE.CircleGeometry(size, 24);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: healthyColor.clone(),
    roughness: 1,
    transparent: true,
    opacity: 0.96
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, 0.06, z);
  mesh.rotation.y = Math.random() * Math.PI;
  mesh.receiveShadow = true;
  mesh.userData.damage = 0;
  mesh.userData.maxDamage = randomRange(0.7, 1.3);

  terrainPatches.push(mesh);
  world.add(mesh);
}

for (let i = 0; i < 150; i += 1) {
  createPatch(
    randomRange(-halfWorld + 3, halfWorld - 3),
    randomRange(-halfWorld + 3, halfWorld - 3),
    randomRange(1.2, 3.4)
  );
}

function createTree(x, z, scale = 1) {
  const tree = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * scale, 0.26 * scale, 1.5 * scale, 7),
    new THREE.MeshStandardMaterial({ color: 0x5f4427, roughness: 1 })
  );

  trunk.position.y = 0.75 * scale;
  trunk.castShadow = true;

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.95 * scale, 2.6 * scale, 7),
    new THREE.MeshStandardMaterial({ color: 0x2f6f39, roughness: 0.9 })
  );

  crown.position.y = 2.5 * scale;
  crown.castShadow = true;

  tree.add(trunk, crown);
  tree.position.set(x, 0, z);
  tree.userData.kind = 'tree';
  tree.userData.health = 1;
  tree.userData.crown = crown;

  props.push(tree);
  world.add(tree);
}

for (let i = 0; i < 54; i += 1) {
  createTree(
    randomRange(-halfWorld + 4, halfWorld - 4),
    randomRange(-halfWorld + 4, halfWorld - 4),
    randomRange(0.72, 1.32)
  );
}

function createBuilding(x, z, width, depth, height, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.78,
      metalness: 0.06
    })
  );

  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = 'building';
  mesh.userData.health = 1;

  props.push(mesh);
  world.add(mesh);
}

function createBlock(cx, cz, cols, rows, spacingX, spacingZ, scale = 1) {
  for (let ix = 0; ix < cols; ix += 1) {
    for (let iz = 0; iz < rows; iz += 1) {
      const x =
        cx +
        (ix - (cols - 1) / 2) * spacingX +
        randomRange(-0.45, 0.45);

      const z =
        cz +
        (iz - (rows - 1) / 2) * spacingZ +
        randomRange(-0.45, 0.45);

      createBuilding(
        x,
        z,
        randomRange(1.7, 3.4) * scale,
        randomRange(1.7, 3.2) * scale,
        randomRange(2.6, 7.4) * scale,
        new THREE.Color().setHSL(
          randomRange(0.055, 0.11),
          randomRange(0.1, 0.22),
          randomRange(0.44, 0.62)
        )
      );
    }
  }
}

createBlock(-11, -8, 3, 2, 5.2, 5.2, 0.92);
createBlock(11, -8, 3, 2, 5, 5.2, 1);
createBlock(-11, 11, 3, 2, 5.1, 5, 0.95);
createBlock(11, 11, 3, 2, 5.1, 5, 1.02);
createBlock(30, -11, 2, 3, 5.5, 5.4, 1.08);

for (let i = 0; i < 10; i += 1) {
  createBuilding(
    randomRange(-36, -27),
    randomRange(22, 34),
    randomRange(1.8, 3.2),
    randomRange(1.8, 3.2),
    randomRange(2, 4.5),
    new THREE.Color().setHSL(
      randomRange(0.06, 0.12),
      randomRange(0.08, 0.18),
      randomRange(0.5, 0.68)
    )
  );
}

function createField(x, z, width, depth) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x8aaa3c,
    roughness: 0.96
  });

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.12, depth),
    material
  );

  mesh.position.set(x, 0.12, z);
  mesh.rotation.y = randomRange(-0.18, 0.18);
  mesh.receiveShadow = true;
  mesh.userData.health = 1;
  mesh.userData.baseColor = new THREE.Color(0x8aaa3c);

  fields.push(mesh);
  world.add(mesh);

  const rows = Math.max(3, Math.round(width / 0.75));

  for (let i = 0; i < rows; i += 1) {
    const row = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.05, depth * 0.9),
      new THREE.MeshBasicMaterial({
        color: 0xc3cf69,
        transparent: true,
        opacity: 0.42
      })
    );

    row.position.set(
      x - width * 0.42 + (i / Math.max(1, rows - 1)) * width * 0.84,
      0.21,
      z
    );
    row.rotation.y = mesh.rotation.y;
    world.add(row);
  }
}

[
  [-31, 7, 8, 5],
  [-31, -8, 7, 4],
  [31, 7, 9, 5],
  [31, 23, 8, 5],
  [-12, 31, 9, 4],
  [8, 31, 8, 4]
].forEach((data) => createField(...data));

function createLake(x, z, radiusX, radiusZ) {
  const geometry = new THREE.CircleGeometry(1, 48);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: 0x2d91b8,
    roughness: 0.24,
    metalness: 0.08,
    transparent: true,
    opacity: 0.88
  });

  const lake = new THREE.Mesh(geometry, material);
  lake.position.set(x, 0.11, z);
  lake.scale.set(radiusX, 1, radiusZ);
  lake.receiveShadow = true;
  lake.userData.water = 1;
  lake.userData.baseScale = lake.scale.clone();

  lakes.push(lake);
  world.add(lake);
}

createLake(14, 31, 5.2, 2.8);
createLake(-32, -27, 4.2, 2.4);

function createLabel(text) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = 512;
  canvas.height = 128;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(5, 13, 24, 0.82)';
  context.roundRect(16, 22, 480, 84, 22);
  context.fill();

  context.fillStyle = '#eef7ff';
  context.font = '700 34px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.8, 1.7, 1);

  return sprite;
}

function createCanister(group, scale) {
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58 * scale, 0.58 * scale, 1.9 * scale, 16),
    new THREE.MeshStandardMaterial({
      color: 0xdcdfe3,
      roughness: 0.42,
      metalness: 0.6
    })
  );

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18 * scale, 0.18 * scale, 0.38 * scale, 12),
    new THREE.MeshStandardMaterial({
      color: 0x24282f,
      roughness: 0.6
    })
  );

  body.position.y = 0.95 * scale;
  cap.position.y = 2.02 * scale;

  group.add(body, cap);
}

function createAcUnit(group, scale) {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4 * scale, 1.45 * scale, 0.9 * scale),
    new THREE.MeshStandardMaterial({
      color: 0xe7ecef,
      roughness: 0.58,
      metalness: 0.15
    })
  );

  const grille = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46 * scale, 0.46 * scale, 0.08 * scale, 24),
    new THREE.MeshStandardMaterial({
      color: 0x5d6870,
      roughness: 0.68,
      metalness: 0.35
    })
  );

  body.position.y = 0.85 * scale;
  grille.rotation.x = Math.PI / 2;
  grille.position.set(0.55 * scale, 0.85 * scale, 0.49 * scale);

  group.add(body, grille);
}

function createColdStorage(group, scale) {
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(3.1 * scale, 2.1 * scale, 2.4 * scale),
    new THREE.MeshStandardMaterial({
      color: 0xd9e4e9,
      roughness: 0.66,
      metalness: 0.18
    })
  );

  const unit = new THREE.Mesh(
    new THREE.BoxGeometry(1.5 * scale, 0.55 * scale, 1.15 * scale),
    new THREE.MeshStandardMaterial({
      color: 0x64727c,
      roughness: 0.55,
      metalness: 0.35
    })
  );

  building.position.y = 1.05 * scale;
  unit.position.set(0, 2.38 * scale, 0);

  group.add(building, unit);
}

function createFactory(group, scale) {
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(4.4 * scale, 2.5 * scale, 3.2 * scale),
    new THREE.MeshStandardMaterial({
      color: 0x74787d,
      roughness: 0.8,
      metalness: 0.12
    })
  );

  building.position.y = 1.25 * scale;
  group.add(building);

  for (let i = 0; i < 2; i += 1) {
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34 * scale, 0.48 * scale, 4.2 * scale, 12),
      new THREE.MeshStandardMaterial({
        color: 0x4e5155,
        roughness: 0.74,
        metalness: 0.2
      })
    );

    stack.position.set(
      (-0.8 + i * 1.6) * scale,
      4 * scale,
      -0.4 * scale
    );

    group.add(stack);
  }
}

function createIndustrialComplex(group, scale) {
  createFactory(group, scale);

  const tankMaterial = new THREE.MeshStandardMaterial({
    color: 0xa6afb6,
    roughness: 0.5,
    metalness: 0.48
  });

  for (let i = 0; i < 2; i += 1) {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8 * scale, 0.8 * scale, 2.3 * scale, 18),
      tankMaterial
    );

    tank.position.set(
      (2.9 + i * 1.85) * scale,
      1.15 * scale,
      0.7 * scale
    );

    group.add(tank);
  }
}

const emitterTypes = {
  canister: {
    label: 'CFC canister',
    strength: 0.48,
    size: 0.62,
    minRadius: 3.8,
    build: createCanister
  },
  ac: {
    label: 'Old AC unit',
    strength: 0.72,
    size: 0.82,
    minRadius: 4.2,
    build: createAcUnit
  },
  storage: {
    label: 'Cold storage',
    strength: 1.02,
    size: 1.05,
    minRadius: 5.3,
    build: createColdStorage
  },
  factory: {
    label: 'CFC factory',
    strength: 1.35,
    size: 1.24,
    minRadius: 6.5,
    build: createFactory
  },
  complex: {
    label: 'Industrial complex',
    strength: 1.72,
    size: 1.42,
    minRadius: 8,
    build: createIndustrialComplex
  }
};

function createEmitter(x, z, typeKey, scale = 1) {
  const type = emitterTypes[typeKey];
  const group = new THREE.Group();

  type.build(group, scale);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(type.size * scale * 0.28, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0xff684f,
      emissive: 0xff2d1d,
      emissiveIntensity: 4.6,
      roughness: 0.25
    })
  );

  core.position.y = 2.7 * scale;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(
      type.size * scale * 1.1,
      type.size * scale * 1.7,
      32
    ),
    new THREE.MeshBasicMaterial({
      color: 0xff8d69,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );

  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;

  const label = createLabel(type.label);
  label.position.y = 4.5 * scale;
  label.visible = false;

  group.add(core, ring, label);
  group.position.set(x, 0, z);
  group.userData.type = typeKey;
  group.userData.label = type.label;
  group.userData.strength = type.strength;
  group.userData.size = type.size * scale;
  group.userData.core = core;
  group.userData.ring = ring;
  group.userData.labelSprite = label;
  group.userData.alive = true;
  group.userData.absorbing = false;
  group.userData.absorbProgress = 0;
  group.userData.requiredRadius = type.minRadius;
  group.userData.baseScale = scale;

  emitters.push(group);
  world.add(group);
}

[
  [-30, -26, 'canister', 0.92],
  [-20, -17, 'canister', 0.78],
  [-8, -29, 'ac', 0.9],
  [7, -25, 'ac', 1],
  [24, -23, 'storage', 0.94],
  [32, -8, 'factory', 0.9],
  [29, 12, 'storage', 1.05],
  [30, 29, 'complex', 0.86],
  [8, 30, 'factory', 0.82],
  [-14, 28, 'storage', 0.98],
  [-31, 16, 'factory', 0.84],
  [-29, -2, 'ac', 1.02],
  [-9, 7, 'canister', 0.84],
  [7, 9, 'ac', 0.92],
  [3, 19, 'storage', 0.86],
  [18, 4, 'factory', 0.8]
].forEach((data) => createEmitter(...data));

const atmosphereLayer = new THREE.Mesh(
  new THREE.CircleGeometry(38, 96),
  new THREE.MeshBasicMaterial({
    color: 0x79c8ef,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);

atmosphereLayer.rotation.x = -Math.PI / 2;
atmosphereLayer.position.y = 8.72;
scene.add(atmosphereLayer);

const atmosphereRing = new THREE.Mesh(
  new THREE.RingGeometry(28, 39, 96),
  new THREE.MeshBasicMaterial({
    color: 0xa9e3ff,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);

atmosphereRing.rotation.x = -Math.PI / 2;
atmosphereRing.position.y = 8.74;
scene.add(atmosphereRing);

const hole = new THREE.Group();
scene.add(hole);

const shadowDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0x121829,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  })
);

shadowDisc.rotation.x = -Math.PI / 2;
shadowDisc.position.y = 8.78;
hole.add(shadowDisc);

const innerHole = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0x03060d,
    transparent: true,
    opacity: 0.84,
    depthWrite: false
  })
);

innerHole.rotation.x = -Math.PI / 2;
innerHole.position.y = 8.8;
hole.add(innerHole);

const ozoneGlow = new THREE.Mesh(
  new THREE.RingGeometry(0.58, 1.16, 96),
  new THREE.MeshBasicMaterial({
    color: 0x7fd8ff,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
);

ozoneGlow.rotation.x = -Math.PI / 2;
ozoneGlow.position.y = 8.82;
hole.add(ozoneGlow);

const holeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.74, 1, 64),
  new THREE.MeshBasicMaterial({
    color: 0x6db9ff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);

holeRing.rotation.x = -Math.PI / 2;
holeRing.position.y = 8.55;
hole.add(holeRing);

const uvDisc = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0xffdd68,
    transparent: true,
    opacity: 0.13,
    depthWrite: false
  })
);

uvDisc.rotation.x = -Math.PI / 2;
uvDisc.position.y = 0.16;
hole.add(uvDisc);

const uvEdge = new THREE.Mesh(
  new THREE.RingGeometry(0.94, 1, 64),
  new THREE.MeshBasicMaterial({
    color: 0xfff49a,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false
  })
);

uvEdge.rotation.x = -Math.PI / 2;
uvEdge.position.y = 0.18;
hole.add(uvEdge);

const beamMaterial = new THREE.MeshBasicMaterial({
  color: 0xffef9e,
  transparent: true,
  opacity: 0.035,
  side: THREE.DoubleSide,
  depthWrite: false
});

const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1.12, 8.4, 48, 1, true),
  beamMaterial
);

beam.position.y = 4.4;
hole.add(beam);

const beamCoreMaterial = new THREE.MeshBasicMaterial({
  color: 0xfff3b0,
  transparent: true,
  opacity: 0.04,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const beamCore = new THREE.Mesh(
  new THREE.CylinderGeometry(0.58, 0.9, 8.45, 48, 1, true),
  beamCoreMaterial
);

beamCore.position.y = 4.38;
hole.add(beamCore);

const groundGlow = new THREE.Mesh(
  new THREE.CircleGeometry(1, 64),
  new THREE.MeshBasicMaterial({
    color: 0xffd968,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
);

groundGlow.rotation.x = -Math.PI / 2;
groundGlow.position.y = 0.2;
hole.add(groundGlow);

const sunOrb = new THREE.Mesh(
  new THREE.SphereGeometry(2.1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff6bd })
);

sunOrb.position.set(-26, 28, -16);
scene.add(sunOrb);

const sunGlowTextureCanvas = document.createElement('canvas');
sunGlowTextureCanvas.width = 256;
sunGlowTextureCanvas.height = 256;

const sunGlowContext = sunGlowTextureCanvas.getContext('2d');
const sunGlowGradient = sunGlowContext.createRadialGradient(
  128,
  128,
  8,
  128,
  128,
  128
);

sunGlowGradient.addColorStop(0, 'rgba(255, 248, 190, 1)');
sunGlowGradient.addColorStop(0.18, 'rgba(255, 224, 120, .85)');
sunGlowGradient.addColorStop(0.5, 'rgba(255, 190, 65, .28)');
sunGlowGradient.addColorStop(1, 'rgba(255, 170, 40, 0)');

sunGlowContext.fillStyle = sunGlowGradient;
sunGlowContext.fillRect(0, 0, 256, 256);

const sunGlowTexture = new THREE.CanvasTexture(sunGlowTextureCanvas);

const sunGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: sunGlowTexture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
);

sunGlow.position.copy(sunOrb.position);
sunGlow.scale.set(15, 15, 1);
scene.add(sunGlow);

const holePosition = new THREE.Vector3(0, 0, 0);
hole.position.copy(holePosition);

function updateHoleVisuals() {
  shadowDisc.scale.setScalar(state.holeRadius);
  innerHole.scale.setScalar(state.holeRadius * 0.78);
  ozoneGlow.scale.setScalar(state.holeRadius * 1.04);
  holeRing.scale.setScalar(state.holeRadius);
  uvDisc.scale.setScalar(state.uvRadius);
  uvEdge.scale.setScalar(state.uvRadius);
  groundGlow.scale.setScalar(state.uvRadius * 0.92);
  beam.scale.set(state.holeRadius * 0.92, 1, state.holeRadius * 0.92);
  beamCore.scale.set(state.holeRadius * 0.82, 1, state.holeRadius * 0.82);

  uvDisc.material.opacity = 0.07 + state.uvIntensity * 0.13;
  beamMaterial.opacity = 0.018 + state.uvIntensity * 0.055;
  beamCoreMaterial.opacity = 0.025 + state.uvIntensity * 0.07;
  groundGlow.material.opacity = 0.045 + state.uvIntensity * 0.07;
  ozoneGlow.material.opacity = 0.24 + state.uvIntensity * 0.28;
}

function clampHole() {
  holePosition.x = THREE.MathUtils.clamp(
    holePosition.x,
    -halfWorld + 2,
    halfWorld - 2
  );

  holePosition.z = THREE.MathUtils.clamp(
    holePosition.z,
    -halfWorld + 2,
    halfWorld - 2
  );
}

function destroyEmitter(emitter) {
  if (!emitter.userData.alive) return;

  const strength = emitter.userData.strength;

  emitter.userData.alive = false;
  state.holeRadius += 0.34 + strength * 0.24;
  state.uvRadius += 0.48 + strength * 0.34;
  state.uvIntensity = Math.min(
    1,
    state.uvIntensity + 0.035 + strength * 0.018
  );
  if (state.comboTimer > 0) {
    state.combo = Math.min(8, state.combo + 1);
  } else {
    state.combo = 1;
  }

  state.comboTimer = 6;
  state.score += Math.round(120 * strength * state.combo);
  state.emittersDestroyed += 1;

  world.remove(emitter);
  updateHoleVisuals();
}

function getUvMultiplier() {
  return state.flareActive ? 2 : 1;
}

function updateSession(delta) {
  if (state.finished) return;

  if (state.comboTimer > 0) {
    state.comboTimer = Math.max(0, state.comboTimer - delta);

    if (state.comboTimer === 0) {
      state.combo = 1;
    }
  }

  if (!state.flareActive && state.gameTime >= state.nextFlareAt) {
    state.flareActive = true;
    state.flareTimer = 10;
    state.nextFlareAt = state.gameTime + 42;
  }

  if (state.flareActive) {
    state.flareTimer = Math.max(0, state.flareTimer - delta);

    if (state.flareTimer === 0) {
      state.flareActive = false;
    }
  }

  const previousStage = state.stage;

  if (state.holeRadius >= 8.5) {
    state.stage = 4;
  } else if (state.holeRadius >= 6.5) {
    state.stage = 3;
  } else if (state.holeRadius >= 5.2) {
    state.stage = 2;
  } else {
    state.stage = 1;
  }

  if (state.stage !== previousStage) {
    state.score += state.stage * 250;
  }

  if (
    state.emittersDestroyed === emitters.length ||
    state.totalDamage >= 0.92
  ) {
    state.finished = true;
  }
}

function paintBurnTrail(delta) {
  const x = ((holePosition.x + halfWorld) / worldSize) * burnCanvas.width;
  const y = ((holePosition.z + halfWorld) / worldSize) * burnCanvas.height;
  const radius = (state.uvRadius / worldSize) * burnCanvas.width;

  const gradient = burnContext.createRadialGradient(
    x,
    y,
    radius * 0.08,
    x,
    y,
    radius
  );

  const uvMultiplier = getUvMultiplier();

  const alpha = Math.min(
    0.16,
    0.015 + state.uvIntensity * uvMultiplier * delta * 0.9
  );

  gradient.addColorStop(0, `rgba(83, 39, 20, ${alpha})`);
  gradient.addColorStop(0.45, `rgba(145, 79, 31, ${alpha * 0.78})`);
  gradient.addColorStop(0.78, `rgba(203, 146, 59, ${alpha * 0.42})`);
  gradient.addColorStop(1, 'rgba(203, 146, 59, 0)');

  burnContext.globalCompositeOperation = 'source-over';
  burnContext.fillStyle = gradient;
  burnContext.beginPath();
  burnContext.arc(x, y, radius, 0, Math.PI * 2);
  burnContext.fill();

  burnTexture.needsUpdate = true;
}

function damageTerrain(delta) {
  paintBurnTrail(delta);

  let damaged = 0;

  for (const patch of terrainPatches) {
    const dx = patch.position.x - holePosition.x;
    const dz = patch.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance < state.uvRadius + 1.2) {
      const factor =
        1 - Math.min(1, distance / (state.uvRadius + 1.2));

      patch.userData.damage = Math.min(
        patch.userData.maxDamage,
        patch.userData.damage +
          delta *
            state.uvIntensity *
            getUvMultiplier() *
            (0.15 + factor * 0.95)
      );

      const progress = Math.min(
        1,
        patch.userData.damage / patch.userData.maxDamage
      );

      const color = healthyColor.clone();

      if (progress < 0.58) {
        color.lerp(dryColor, progress / 0.58);
      } else {
        color
          .copy(dryColor)
          .lerp(
            burnedColor,
            (progress - 0.58) / 0.42
          );
      }

      patch.material.color.copy(color);
      damaged += progress;
    } else {
      damaged += Math.min(
        1,
        patch.userData.damage / patch.userData.maxDamage
      );
    }
  }

  for (const prop of props) {
    const dx = prop.position.x - holePosition.x;
    const dz = prop.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance >= state.uvRadius) continue;

    const exposure =
      1 - Math.min(1, distance / state.uvRadius);

    prop.userData.health = Math.max(
      0,
      prop.userData.health -
        delta *
          state.uvIntensity *
          getUvMultiplier() *
          (0.035 + exposure * 0.11)
    );

    if (prop.userData.kind === 'tree') {
      const progress = 1 - prop.userData.health;
      const treeHealthy = new THREE.Color(0x2f6f39);
      const treeDry = new THREE.Color(0x8b6737);

      const treeBurned = new THREE.Color(0x4a3322);
      const treeColor = treeHealthy.clone();

      if (progress < 0.68) {
        treeColor.lerp(treeDry, progress / 0.68);
      } else {
        treeColor
          .copy(treeDry)
          .lerp(treeBurned, (progress - 0.68) / 0.32);
      }

      prop.userData.crown.material.color.copy(treeColor);

      prop.scale.y =
        0.58 + prop.userData.health * 0.42;

      prop.rotation.z =
        Math.sin(prop.position.x * 0.7) * progress * 0.08;
    }

    if (prop.userData.kind === 'building') {
      const progress = 1 - prop.userData.health;

      prop.material.emissive.setRGB(
        progress * 0.08,
        progress * 0.035,
        0
      );
    }
  }

  for (const field of fields) {
    const distance = Math.hypot(
      field.position.x - holePosition.x,
      field.position.z - holePosition.z
    );

    if (distance < state.uvRadius) {
      const exposure =
        1 - Math.min(1, distance / state.uvRadius);

      field.userData.health = Math.max(
        0,
        field.userData.health -
          delta *
            state.uvIntensity *
            getUvMultiplier() *
            (0.055 + exposure * 0.18)
      );

      const progress = 1 - field.userData.health;
      const fieldDry = new THREE.Color(0xc49a47);
      const fieldBurned = new THREE.Color(0x70472d);
      const color = field.userData.baseColor.clone();

      if (progress < 0.7) {
        color.lerp(fieldDry, progress / 0.7);
      } else {
        color
          .copy(fieldDry)
          .lerp(fieldBurned, (progress - 0.7) / 0.3);
      }

      field.material.color.copy(color);
    }
  }

  for (const lake of lakes) {
    const distance = Math.hypot(
      lake.position.x - holePosition.x,
      lake.position.z - holePosition.z
    );

    if (distance < state.uvRadius) {
      const exposure =
        1 - Math.min(1, distance / state.uvRadius);

      lake.userData.water = Math.max(
        0.18,
        lake.userData.water -
          delta *
            state.uvIntensity *
            getUvMultiplier() *
            (0.01 + exposure * 0.045)
      );

      const water = lake.userData.water;

      lake.scale.set(
        lake.userData.baseScale.x * water,
        1,
        lake.userData.baseScale.z * water
      );

      lake.material.opacity =
        0.34 + water * 0.54;

      lake.material.color
        .set(0x2d91b8)
        .lerp(new THREE.Color(0x756844), 1 - water);
    }
  }

  state.totalDamage =
    damaged / terrainPatches.length;
}

function checkEmitters(delta) {
  for (const emitter of emitters) {
    if (!emitter.userData.alive) continue;

    emitter.rotation.y += 0.012;

    if (emitter.userData.absorbing) {
      emitter.userData.absorbProgress = Math.min(
        1,
        emitter.userData.absorbProgress + delta * 1.9
      );

      const progress = emitter.userData.absorbProgress;
      const target = new THREE.Vector3(
        hole.position.x,
        8.55,
        hole.position.z
      );

      emitter.position.lerp(target, 0.08 + progress * 0.1);
      emitter.rotation.y += delta * 9;
      emitter.rotation.x += delta * 4;
      emitter.scale.setScalar(Math.max(0.04, 1 - progress * 0.96));

      if (progress >= 1) {
        destroyEmitter(emitter);
      }

      continue;
    }

    emitter.userData.core.position.y =
      emitter.userData.size *
      (
        1.08 +
        Math.sin(
          state.gameTime * 4 +
          emitter.position.x
        ) *
          0.08
      );

    const dx =
      emitter.position.x - holePosition.x;
    const dz =
      emitter.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);
    const canAbsorb =
      state.holeRadius >= emitter.userData.requiredRadius;

    emitter.userData.ring.material.color.set(
      canAbsorb ? 0xff8d69 : 0x9d72ff
    );

    emitter.userData.core.material.emissive.set(
      canAbsorb ? 0xff2d1d : 0x5522aa
    );

    emitter.userData.labelSprite.visible = distance < 10;

    if (emitter.userData.labelSprite.visible) {
      const lockText = canAbsorb
        ? emitter.userData.label
        : `${emitter.userData.label} · need ${Math.ceil(emitter.userData.requiredRadius * 2)} m`;

      const labelTexture = emitter.userData.labelSprite.material.map;
      const labelCanvas = labelTexture.image;
      const context = labelCanvas.getContext('2d');

      context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
      context.fillStyle = 'rgba(5, 13, 24, 0.84)';
      context.roundRect(16, 22, 480, 84, 22);
      context.fill();
      context.fillStyle = canAbsorb ? '#eef7ff' : '#c7b6ff';
      context.font = '700 30px Inter, Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(lockText, 256, 64);
      labelTexture.needsUpdate = true;
    }

    if (
      canAbsorb &&
      distance <
        state.holeRadius * 0.88 +
          emitter.userData.size
    ) {
      emitter.userData.absorbing = true;
      emitter.userData.ring.visible = false;
    }
  }
}

function updateTraffic(delta) {
  for (const vehicle of vehicles) {
    const route = vehicle.userData.route;
    const dx = vehicle.position.x - holePosition.x;
    const dz = vehicle.position.z - holePosition.z;
    const distance = Math.hypot(dx, dz);

    if (distance < state.uvRadius * 0.72) {
      vehicle.userData.evacuating = true;
    }

    if (distance < state.uvRadius * 0.34 && state.uvIntensity > 0.35) {
      vehicle.userData.disabled = true;
    }

    if (vehicle.userData.disabled) {
      vehicle.userData.speed = THREE.MathUtils.lerp(
        vehicle.userData.speed,
        0,
        0.08
      );

      vehicle.rotation.z =
        Math.sin(vehicle.position.x * 0.4 + vehicle.position.z) * 0.08;

      continue;
    }

    const targetSpeed = vehicle.userData.evacuating
      ? vehicle.userData.baseSpeed * 1.85
      : vehicle.userData.baseSpeed;

    vehicle.userData.speed = THREE.MathUtils.lerp(
      vehicle.userData.speed,
      targetSpeed,
      0.035
    );

    const length = route.max - route.min;
    vehicle.userData.t +=
      (delta * vehicle.userData.speed * route.dir) / length;

    if (vehicle.userData.t > 1) {
      vehicle.userData.t -= 1;
    }

    if (vehicle.userData.t < 0) {
      vehicle.userData.t += 1;
    }

    const position = route.min + length * vehicle.userData.t;

    if (route.axis === 'x') {
      vehicle.position.x = position;
      vehicle.position.z = route.fixed + (route.dir > 0 ? -0.65 : 0.65);
      vehicle.rotation.y = route.dir > 0 ? 0 : Math.PI;
    } else {
      vehicle.position.x = route.fixed + (route.dir > 0 ? 0.65 : -0.65);
      vehicle.position.z = position;
      vehicle.rotation.y = route.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    if (
      vehicle.userData.evacuating &&
      distance > state.uvRadius * 1.5
    ) {
      vehicle.userData.evacuating = false;
    }
  }
}

function updateHud() {
  const stages = {
    1: ['Stage 1 · Local breach', 'Absorb canisters and old AC units.'],
    2: ['Stage 2 · District damage', 'Cold storage facilities are now within reach.'],
    3: ['Stage 3 · Urban collapse', 'Factories can now be absorbed.'],
    4: ['Stage 4 · Regional event', 'Industrial complexes are vulnerable.']
  };

  const stage = stages[state.stage];
  const eventBanner = document.querySelector('#eventBanner');

  document.querySelector('#stageValue').textContent =
    state.finished ? 'Collapse complete' : stage[0];

  document.querySelector('#objectiveText').textContent =
    state.finished
      ? 'All major sources neutralized or the surface is critically damaged.'
      : stage[1];

  document.querySelector('#comboValue').textContent =
    `x${state.combo} combo`;

  eventBanner.hidden = !state.flareActive;

  if (state.flareActive) {
    eventBanner.querySelector('span').textContent =
      `UV output x2 · ${Math.ceil(state.flareTimer)}s`;
  }

  document.querySelector('#holeValue').textContent =
    `${Math.round(state.holeRadius * 2)} m`;

  document.querySelector('#uvValue').textContent =
    `${Math.round(state.uvIntensity * 100)}%`;

  document.querySelector('#damageValue').textContent =
    `${Math.round(state.totalDamage * 100)}%`;

  document.querySelector('#scoreValue').textContent =
    state.score.toLocaleString('en-US');

  document.querySelector('#holeBar').style.width =
    `${Math.min(100, (state.holeRadius / 16) * 100)}%`;

  document.querySelector('#uvBar').style.width =
    `${state.uvIntensity * 100}%`;

  document.querySelector('#damageBar').style.width =
    `${state.totalDamage * 100}%`;
}

function updatePointerTarget(event) {
  const rect = canvas.getBoundingClientRect();

  pointer.x =
    ((event.clientX - rect.left) /
      rect.width) *
      2 -
    1;

  pointer.y =
    -(
      (event.clientY - rect.top) /
      rect.height
    ) *
      2 +
    1;

  raycaster.setFromCamera(pointer, camera);

  const hit = raycaster.intersectObject(
    ground,
    false
  )[0];

  if (!hit) return;

  pointerTarget.copy(hit.point);
  pointerTarget.y = 0;
  pointerActive = true;
}

function moveHole(delta) {
  const move = new THREE.Vector3();

  if (
    keys.has('KeyW') ||
    keys.has('ArrowUp')
  ) {
    move.z -= 1;
  }

  if (
    keys.has('KeyS') ||
    keys.has('ArrowDown')
  ) {
    move.z += 1;
  }

  if (
    keys.has('KeyA') ||
    keys.has('ArrowLeft')
  ) {
    move.x -= 1;
  }

  if (
    keys.has('KeyD') ||
    keys.has('ArrowRight')
  ) {
    move.x += 1;
  }

  if (move.lengthSq() > 0) {
    pointerActive = false;

    move
      .normalize()
      .multiplyScalar(
        delta *
          (10 +
            state.holeRadius * 0.18)
      );

    holePosition.add(move);
  } else if (pointerActive) {
    const toTarget = pointerTarget
      .clone()
      .sub(holePosition);

    toTarget.y = 0;

    if (toTarget.length() > 0.35) {
      const speed =
        delta *
        (9 +
          state.holeRadius * 0.16);

      holePosition.add(
        toTarget
          .normalize()
          .multiplyScalar(
            Math.min(
              speed,
              toTarget.length()
            )
          )
      );
    }
  }

  clampHole();

  hole.position.x = THREE.MathUtils.lerp(
    hole.position.x,
    holePosition.x,
    0.22
  );

  hole.position.z = THREE.MathUtils.lerp(
    hole.position.z,
    holePosition.z,
    0.22
  );
}

function updateCamera() {
  const target = new THREE.Vector3(
    hole.position.x * 0.26,
    0,
    hole.position.z * 0.26
  );

  const zoomOut = Math.min(
    18,
    Math.max(
      0,
      state.holeRadius - 4.4
    ) * 0.78
  );

  const desired = new THREE.Vector3(
    hole.position.x * 0.16,
    42 + zoomOut,
    50 +
      zoomOut * 0.78 +
      hole.position.z * 0.1
  );

  camera.position.lerp(
    desired,
    0.025
  );

  camera.lookAt(target);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setSize(
    width,
    height,
    false
  );

  camera.aspect =
    width / height;

  camera.updateProjectionMatrix();
}

canvas.addEventListener(
  'pointermove',
  updatePointerTarget
);

canvas.addEventListener(
  'pointerdown',
  updatePointerTarget
);

window.addEventListener(
  'keydown',
  (event) => {
    keys.add(event.code);
  }
);

window.addEventListener(
  'keyup',
  (event) => {
    keys.delete(event.code);
  }
);

window.addEventListener(
  'resize',
  resize
);

document
  .querySelector('#restartBtn')
  .addEventListener(
    'click',
    () => {
      window.location.reload();
    }
  );

updateHoleVisuals();
resize();

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(
    clock.getDelta(),
    0.05
  );

  state.gameTime += delta;

  moveHole(delta);
  checkEmitters(delta);
  damageTerrain(delta);
  updateTraffic(delta);
  updateSession(delta);
  updateCamera();
  updateHud();

  holeRing.rotation.z +=
    delta * 0.2;

  ozoneGlow.rotation.z -=
    delta * 0.08;

  uvEdge.rotation.z -=
    delta * 0.12;

  atmosphereRing.rotation.z +=
    delta * 0.006;

  const flarePulse = state.flareActive
    ? 1.18 + Math.sin(state.gameTime * 7) * 0.08
    : 1;

  sunGlow.scale.set(
    15 * flarePulse,
    15 * flarePulse,
    1
  );

  sun.material = sun.material;

  if (state.flareActive) {
    sun.intensity = 7.2;
    sunOrb.scale.setScalar(1.08);
    beamCoreMaterial.opacity =
      0.12 + Math.sin(state.gameTime * 8) * 0.025;
  } else {
    sun.intensity = 5;
    sunOrb.scale.setScalar(1);
  }

  renderer.render(
    scene,
    camera
  );
}

animate();
