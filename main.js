import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- CONFIGURATION ---
const GRAVITY = 30;
const JUMP_FORCE = 10;
const MOVE_SPEED = 10;
const KNIFE_SPEED_MULT = 1.5;
const PLAYER_HEIGHT = 1.6;
const CROUCH_HEIGHT = 0.9;
const PLAYER_RADIUS = 0.4;
const ARENA_SIZE = 80;     // half-size
const CEILING_HEIGHT = 15;
const DASH_SPEED = 35;
const DASH_DURATION = 0.2;
const FOOTSTEP_INTERVAL = 0.4;

// Bots
const BOT_SPEED = 3.5;
const BOT_COUNT = 8;
const BOT_HEALTH = 60;
const BOT_DAMAGE = 8;
const BOT_ATTACK_RANGE = 2.5;        // melee range (fallback)
const BOT_SHOOT_RANGE = 12;          // range at which bots shoot
const BOT_DETECTION_RANGE = 18;      // range at which bots detect and chase the player
const BOT_ATTACK_COOLDOWN = 1500;    // ms between bot shots
const BOT_BULLET_SPEED = 30;
const PLAYER_MAX_HEALTH = 100;

// --- GAME STATE ---
let camera, scene, renderer, controls;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let prevTime = performance.now();
let playerHealth = PLAYER_MAX_HEALTH;
let kills = 0;
let gameInitialized = false;
let isCrouching = false;
let isReloading = false;
let reloadTimer = 0;
let doorOpen = true;
let doorMesh = null;
let doorInteractionActive = false;

// New States
let isDashing = false;
let dashTimer = 0;
let dashDir = new THREE.Vector3();
let screenShake = 0;
let muzzleFlash = null;
let muzzleFlashTimer = 0;
let stepTimer = 0;
let footstepAudioCtx = null;
let lastStepPos = new THREE.Vector3();

// Collision
const colliders = [];   // array of THREE.Box3
const floorSegments = []; // {box3, topY} for stairs/ramps

// Weapons
const weapons = {
    knife:   { name: 'Faca',              color: 0xffaa00, fireRate: 500,  ammo: Infinity, maxAmmo: Infinity, damage: 50,  range: 3,    isKnife: true,  key: '4', spread: 0 },
    pistol:  { name: 'Pistola',           color: 0x00ff7f, fireRate: 400,  ammo: 12,       maxAmmo: 12,       damage: 25,  range: 1000, isKnife: false, key: '1', spread: 0.02, recoil: 0.04 },
    smg:     { name: 'Submetralhadora',   color: 0x00d2ff, fireRate: 70,   ammo: 30,       maxAmmo: 30,       damage: 12,  range: 1000, isKnife: false, key: '2', spread: 0.06, recoil: 0.025 },
    sniper:  { name: 'Rifle de Precisão', color: 0xff007f, fireRate: 1500, ammo: 5,        maxAmmo: 5,        damage: 100, range: 1000, isKnife: false, key: '3', hasScope: true, spread: 0.005, recoil: 0.3 },
    ak47:    { name: 'AK-47',             color: 0xffaa00, fireRate: 90,   ammo: 30,       maxAmmo: 30,       damage: 35,  range: 1000, isKnife: false, key: '5', spread: 0.045, recoil: 0.05 }
};
let currentWeapon = weapons.pistol;
let currentWeaponKey = 'pistol';
let lastFireTime = 0;
let weaponGroup; // visible weapon mesh
let isADS = false; // Aim Down Sights
let adsLerp = 0;   // for smooth zooming
const BASE_FOV = 75;
const ADS_FOV_MULT = 0.6;
const SNIPER_FOV_MULT = 0.15;

// Bots
const bots = [];

// Bot bullets
const botBullets = [];

// Weapon Pickups
const weaponPickups = [];
const PICKUP_RANGE = 2.5;
const PICKUP_RESPAWN_TIME = 15; // seconds

// ========================
// INITIALIZATION
// ========================
try {
    init();
    animate();
} catch (err) {
    console.error('Erro na inicialização:', err);
    const instructions = document.getElementById('instructions');
    if (instructions) {
        instructions.innerHTML = `<h1>Erro</h1><p>${err.message}</p>`;
    }
}

function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080818);
    scene.fog = new THREE.FogExp2(0x080818, 0.012);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, PLAYER_HEIGHT, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
    sunLight.position.set(10, CEILING_HEIGHT - 1, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    // Neon Point Lights
    const colors = [0x00ff7f, 0x00d2ff, 0xff007f, 0xffaa00];
    const positions = [
        [-ARENA_SIZE * 0.7, 6, -ARENA_SIZE * 0.7],
        [ARENA_SIZE * 0.7, 6, -ARENA_SIZE * 0.7],
        [-ARENA_SIZE * 0.7, 6, ARENA_SIZE * 0.7],
        [ARENA_SIZE * 0.7, 6, ARENA_SIZE * 0.7]
    ];
    for (let i = 0; i < 4; i++) {
        const pl = new THREE.PointLight(colors[i], 3, 50);
        pl.position.set(...positions[i]);
        scene.add(pl);

        // Visible bulb
        const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 8, 8),
            new THREE.MeshBasicMaterial({ color: colors[i] })
        );
        bulb.position.copy(pl.position);
        scene.add(bulb);
    }

    // Controls
    controls = new PointerLockControls(camera, document.body);
    const instructions = document.getElementById('instructions');
    instructions.addEventListener('click', () => {
        controls.lock();
    });
    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
        gameInitialized = true;
    });
    controls.addEventListener('unlock', () => {
        instructions.style.display = 'block';
    });
    scene.add(controls.getObject());

    // Event Listeners
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', (e) => {
        if (!controls.isLocked) return;
        if (e.button === 0) fire();
        if (e.button === 2) isADS = true;
    });
    document.addEventListener('mouseup', (e) => {
        if (e.button === 2) isADS = false;
    });
    // Prevent context menu
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Build World
    createArena();
    createStairs();
    createWeaponHouse();

    // Weapon Model
    createWeaponModel('pistol');

    // Bots
    spawnBots();

    window.addEventListener('resize', onWindowResize);

    // Force initial render to avoid black screen
    renderer.render(scene, camera);
}

function onKeyDown(e) {
    switch (e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyD': moveRight = true; break;
        case 'Space': if (canJump) { velocity.y = JUMP_FORCE; canJump = false; } break;
        case 'Digit1': switchWeapon('pistol'); break;
        case 'Digit2': switchWeapon('smg'); break;
        case 'Digit3': switchWeapon('sniper'); break;
        case 'Digit4': switchWeapon('knife'); break;
        case 'Digit5': switchWeapon('ak47'); break;
        case 'KeyR': reloadWeapon(); break;
        case 'KeyE': pickupPressed = true; break;
        case 'ShiftLeft':
        case 'ShiftRight': startDash(); break;
        case 'ControlLeft':
        case 'KeyC': isCrouching = true; break;
    }
}

function onKeyUp(e) {
    switch (e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyD': moveRight = false; break;
        case 'ControlLeft':
        case 'KeyC': isCrouching = false; break;
    }
}

function toggleDoor() {
    if (!doorMesh) return;
    doorOpen = !doorOpen;
    const hx = 25; // center of house
    if (doorOpen) {
        doorMesh.position.x = hx + 2.8;
    } else {
        doorMesh.position.x = hx;
    }
    doorMesh.collisionBox.setFromObject(doorMesh);
}

// ========================
// ARENA (Closed Room)
// ========================
function createArena() {
    const S = ARENA_SIZE;
    const H = CEILING_HEIGHT;

    // --- Floor ---
    const floorGeo = new THREE.PlaneGeometry(S * 2, S * 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.7 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Neon Grid on floor
    const grid = new THREE.GridHelper(S * 2, 40, 0x00ff7f, 0x111111);
    grid.position.y = 0.01;
    scene.add(grid);

    // --- Ceiling ---
    const ceilGeo = new THREE.PlaneGeometry(S * 2, S * 2);
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x0d0d1a, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide });
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    ceil.receiveShadow = true;
    scene.add(ceil);

    // --- Ceiling Structural Beams (cross pattern) ---
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.4, metalness: 0.8 });
    // Main beams along X axis
    for (let i = -3; i <= 3; i++) {
        const beamGeo = new THREE.BoxGeometry(S * 2, 0.6, 0.8);
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(0, H - 0.3, i * 10);
        beam.castShadow = true;
        scene.add(beam);
    }
    // Cross beams along Z axis
    for (let i = -3; i <= 3; i++) {
        const beamGeo = new THREE.BoxGeometry(0.8, 0.4, S * 2);
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(i * 10, H - 0.2, 0);
        beam.castShadow = true;
        scene.add(beam);
    }

    // --- Ceiling Panels (between beams) ---
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x151525, roughness: 0.9, metalness: 0.2 });
    for (let ix = -3; ix < 3; ix++) {
        for (let iz = -3; iz < 3; iz++) {
            const panelGeo = new THREE.PlaneGeometry(8.5, 8.5);
            const panel = new THREE.Mesh(panelGeo, panelMat);
            panel.rotation.x = Math.PI / 2;
            panel.position.set(ix * 10 + 5, H - 0.55, iz * 10 + 5);
            scene.add(panel);
        }
    }

    // --- Ceiling Neon Light Strips ---
    for (let i = -3; i <= 3; i++) {
        // Horizontal strips
        const stripGeo = new THREE.BoxGeometry(S * 1.8, 0.08, 0.2);
        const stripMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, H - 0.6, i * 10);
        scene.add(strip);

        // Glow point light beneath each strip
        if (i % 2 === 0) {
            const stripLight = new THREE.PointLight(0x00d2ff, 1.5, 15);
            stripLight.position.set(0, H - 1, i * 10);
            scene.add(stripLight);
        }
    }

    // Vertical neon strips (perpendicular)
    for (let i = -2; i <= 2; i++) {
        const stripGeo = new THREE.BoxGeometry(0.2, 0.08, S * 1.8);
        const stripMat = new THREE.MeshBasicMaterial({ color: 0xff007f });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(i * 15, H - 0.6, 0);
        scene.add(strip);
    }

    // --- Ceiling corner accent lights ---
    const cornerPositions = [
        [-S + 3, H - 1, -S + 3],
        [S - 3, H - 1, -S + 3],
        [-S + 3, H - 1, S - 3],
        [S - 3, H - 1, S - 3]
    ];
    const cornerColors = [0x00ff7f, 0x00d2ff, 0xff007f, 0xffaa00];
    for (let i = 0; i < 4; i++) {
        const cl = new THREE.PointLight(cornerColors[i], 2, 20);
        cl.position.set(...cornerPositions[i]);
        scene.add(cl);

        // Light fixture visual
        const fixGeo = new THREE.BoxGeometry(1.5, 0.15, 1.5);
        const fixMat = new THREE.MeshBasicMaterial({ color: cornerColors[i] });
        const fix = new THREE.Mesh(fixGeo, fixMat);
        fix.position.set(...cornerPositions[i]);
        fix.position.y = H - 0.55;
        scene.add(fix);
    }

    // --- Walls ---
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.6 });
    const wallThickness = 1;

    const wallDefs = [
        // {w, h, d, x, y, z}
        { w: S * 2 + wallThickness * 2, h: H, d: wallThickness, x: 0, y: H / 2, z: S + wallThickness / 2 },   // North
        { w: S * 2 + wallThickness * 2, h: H, d: wallThickness, x: 0, y: H / 2, z: -S - wallThickness / 2 },  // South
        { w: wallThickness, h: H, d: S * 2, x: S + wallThickness / 2, y: H / 2, z: 0 },    // East
        { w: wallThickness, h: H, d: S * 2, x: -S - wallThickness / 2, y: H / 2, z: 0 },   // West
    ];

    for (const def of wallDefs) {
        const geo = new THREE.BoxGeometry(def.w, def.h, def.d);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(def.x, def.y, def.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        // Add collider
        const box = new THREE.Box3().setFromObject(mesh);
        colliders.push(box);
    }

    // Add neon stripes on walls
    const neonColors = [0x00ff7f, 0x00d2ff, 0xff007f, 0xffaa00];
    for (let i = 0; i < 4; i++) {
        const def = wallDefs[i];
        for (let j = 1; j <= 2; j++) {
            const stripeH = 0.15;
            const stripeGeo = new THREE.BoxGeometry(
                def.d > 1 ? 0.2 : def.w * 0.9,
                stripeH,
                def.d > 1 ? def.d * 0.9 : 0.2
            );
            const stripeMat = new THREE.MeshBasicMaterial({ color: neonColors[i] });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.set(def.x, j * 3, def.z);
            scene.add(stripe);
        }
    }

    // --- Cover Boxes ---
    const coverMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.5 });
    const coverPositions = [
        { s: [3, 2, 3], p: [15, 1, 15] },
        { s: [3, 2, 3], p: [-15, 1, 15] },
        { s: [3, 2, 3], p: [15, 1, -15] },
        { s: [3, 2, 3], p: [-15, 1, -15] },
        { s: [5, 1.5, 1], p: [0, 0.75, 20] },
        { s: [5, 1.5, 1], p: [0, 0.75, -20] },
        { s: [1, 1.5, 5], p: [20, 0.75, 0] },
        { s: [1, 1.5, 5], p: [-20, 0.75, 0] },
        { s: [2, 3, 2], p: [10, 1.5, 0] },
        { s: [2, 3, 2], p: [-10, 1.5, 0] },
    ];
    for (const c of coverPositions) {
        const geo = new THREE.BoxGeometry(...c.s);
        const mesh = new THREE.Mesh(geo, coverMat);
        mesh.position.set(...c.p);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        colliders.push(new THREE.Box3().setFromObject(mesh));
    }

    // --- Detection Zone visual indicator (circle on floor) ---
    // A faint ring showing the bot detection radius visually
    createDetectionZoneMarkers();
}

function createDetectionZoneMarkers() {
    // Create subtle pulsing ring markers around bot spawn areas
    const ringGeo = new THREE.RingGeometry(BOT_DETECTION_RANGE - 0.3, BOT_DETECTION_RANGE, 64);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
}

// ========================
// WEAPON HOUSE
// ========================
function createWeaponHouse() {
    const hx = 25;  // house center X
    const hz = 25;  // house center Z
    const hw = 10;  // house width
    const hd = 8;   // house depth
    const hh = 5;   // house wall height
    const roofH = 2; // roof extra height
    const wallT = 0.5; // wall thickness

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.5, metalness: 0.3 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3, metalness: 0.6 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.5 });

    // --- House Floor ---
    const hFloorGeo = new THREE.BoxGeometry(hw, 0.15, hd);
    const hFloor = new THREE.Mesh(hFloorGeo, floorMat);
    hFloor.position.set(hx, 0.075, hz);
    hFloor.receiveShadow = true;
    scene.add(hFloor);

    // Floor neon grid pattern
    const fGridGeo = new THREE.BoxGeometry(hw - 1, 0.02, 0.05);
    const fGridMat = new THREE.MeshBasicMaterial({ color: 0x00ff7f, transparent: true, opacity: 0.4 });
    for (let i = -3; i <= 3; i++) {
        const line = new THREE.Mesh(fGridGeo, fGridMat);
        line.position.set(hx, 0.16, hz + i * 1);
        scene.add(line);
    }

    // --- Back Wall ---
    const backWallGeo = new THREE.BoxGeometry(hw, hh, wallT);
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(hx, hh / 2, hz + hd / 2);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    scene.add(backWall);
    colliders.push(new THREE.Box3().setFromObject(backWall));

    // --- Left Wall ---
    const leftWallGeo = new THREE.BoxGeometry(wallT, hh, hd);
    const leftWall = new THREE.Mesh(leftWallGeo, wallMat);
    leftWall.position.set(hx - hw / 2, hh / 2, hz);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    scene.add(leftWall);
    colliders.push(new THREE.Box3().setFromObject(leftWall));

    // --- Right Wall ---
    const rightWall = new THREE.Mesh(leftWallGeo, wallMat);
    rightWall.position.set(hx + hw / 2, hh / 2, hz);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    scene.add(rightWall);
    colliders.push(new THREE.Box3().setFromObject(rightWall));

    // --- Front Wall (with door opening) ---
    // Left part of front wall
    const frontLeftGeo = new THREE.BoxGeometry((hw - 3) / 2, hh, wallT);
    const frontLeft = new THREE.Mesh(frontLeftGeo, wallMat);
    frontLeft.position.set(hx - hw / 4 - 0.75, hh / 2, hz - hd / 2);
    frontLeft.castShadow = true;
    scene.add(frontLeft);
    colliders.push(new THREE.Box3().setFromObject(frontLeft));

    // Right part of front wall
    const frontRight = new THREE.Mesh(frontLeftGeo, wallMat);
    frontRight.position.set(hx + hw / 4 + 0.75, hh / 2, hz - hd / 2);
    frontRight.castShadow = true;
    scene.add(frontRight);
    colliders.push(new THREE.Box3().setFromObject(frontRight));

    // Top part above door
    const frontTopGeo = new THREE.BoxGeometry(3, hh - 3, wallT);
    const frontTop = new THREE.Mesh(frontTopGeo, wallMat);
    frontTop.position.set(hx, hh - (hh - 3) / 2, hz - hd / 2);
    frontTop.castShadow = true;
    scene.add(frontTop);
    colliders.push(new THREE.Box3().setFromObject(frontTop));

    // --- Door Frame (neon glow) ---
    const doorFrameMat = new THREE.MeshBasicMaterial({ color: 0x00ff7f });
    // Left frame
    const dfLeft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3, 0.6), doorFrameMat);
    dfLeft.position.set(hx - 1.5, 1.5, hz - hd / 2);
    scene.add(dfLeft);
    // Right frame
    const dfRight = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3, 0.6), doorFrameMat);
    dfRight.position.set(hx + 1.5, 1.5, hz - hd / 2);
    scene.add(dfRight);
    // Top frame
    const dfTop = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.15, 0.6), doorFrameMat);
    dfTop.position.set(hx, 3, hz - hd / 2);
    scene.add(dfTop);

    // --- Physical Door ---
    const doorGeo = new THREE.BoxGeometry(2.8, 2.9, 0.1);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.8, roughness: 0.2 });
    doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(hx, 1.45, hz - hd / 2);
    scene.add(doorMesh);
    
    // Door collision (box3 will be updated dynamically)
    doorMesh.collisionBox = new THREE.Box3();
    doorMesh.collisionBox.setFromObject(doorMesh);
    colliders.push(doorMesh.collisionBox);
    
    // Start with door open
    doorOpen = true;
    doorMesh.position.x += 2.8; // Slide open
    doorMesh.collisionBox.setFromObject(doorMesh);

    // --- Door Button ---
    const btnBase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    btnBase.position.set(hx - 2, 1.5, hz - hd / 2 - 0.2);
    scene.add(btnBase);
    
    const btnInner = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    btnInner.position.set(hx - 2, 1.5, hz - hd / 2 - 0.3);
    btnInner.name = 'doorButton';
    scene.add(btnInner);

    // Door light
    const doorLight = new THREE.PointLight(0x00ff7f, 3, 8);
    doorLight.position.set(hx, 3.5, hz - hd / 2 - 1);
    scene.add(doorLight);

    // --- Roof ---
    const roofGeo = new THREE.BoxGeometry(hw + 1.5, 0.4, hd + 1.5);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(hx, hh + 0.2, hz);
    roof.castShadow = true;
    roof.receiveShadow = true;
    scene.add(roof);

    // Roof edge trim (neon)
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
    // Front trim
    const trimF = new THREE.Mesh(new THREE.BoxGeometry(hw + 1.5, 0.12, 0.12), trimMat);
    trimF.position.set(hx, hh + 0.4, hz - hd / 2 - 0.7);
    scene.add(trimF);
    // Back trim
    const trimB = new THREE.Mesh(new THREE.BoxGeometry(hw + 1.5, 0.12, 0.12), trimMat);
    trimB.position.set(hx, hh + 0.4, hz + hd / 2 + 0.7);
    scene.add(trimB);
    // Left trim
    const trimL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, hd + 1.5), trimMat);
    trimL.position.set(hx - hw / 2 - 0.7, hh + 0.4, hz);
    scene.add(trimL);
    // Right trim
    const trimR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, hd + 1.5), trimMat);
    trimR.position.set(hx + hw / 2 + 0.7, hh + 0.4, hz);
    scene.add(trimR);

    // --- Interior Light ---
    const interiorLight = new THREE.PointLight(0xffaa00, 4, 15);
    interiorLight.position.set(hx, hh - 0.5, hz);
    scene.add(interiorLight);

    // Light fixture bulb
    const bulbGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(hx, hh - 0.3, hz);
    scene.add(bulb);

    // --- Sign above door: "ARMAS" ---
    const signBg = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.8, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    signBg.position.set(hx, hh - 0.2, hz - hd / 2 - 0.1);
    scene.add(signBg);

    // Neon sign letters (simplified as colored blocks representing "ARMAS")
    const signMat = new THREE.MeshBasicMaterial({ color: 0xff007f });
    const letterWidth = 0.35;
    const letters = ['A', 'R', 'M', 'A', 'S'];
    for (let i = 0; i < letters.length; i++) {
        const letterGeo = new THREE.BoxGeometry(letterWidth, 0.5, 0.15);
        const letter = new THREE.Mesh(letterGeo, signMat);
        letter.position.set(hx - 0.9 + i * 0.45, hh - 0.2, hz - hd / 2 - 0.15);
        scene.add(letter);
    }

    // Sign glow
    const signLight = new THREE.PointLight(0xff007f, 2, 8);
    signLight.position.set(hx, hh, hz - hd / 2 - 1);
    scene.add(signLight);

    // --- Wall Decorations (weapon racks) ---
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x333344, metalness: 0.7 });
    // Back wall rack strips
    for (let i = 0; i < 3; i++) {
        const rackGeo = new THREE.BoxGeometry(hw - 2, 0.1, 0.3);
        const rack = new THREE.Mesh(rackGeo, rackMat);
        rack.position.set(hx, 1 + i * 1.3, hz + hd / 2 - 0.3);
        scene.add(rack);
    }

    // --- Weapon Pickups inside the house ---
    const pickupDefs = [
        { type: 'pistol',  pos: [hx - 2.5, 1.3, hz + 2.5],  color: 0x00ff7f },
        { type: 'smg',     pos: [hx + 2.5, 1.3, hz + 2.5],  color: 0x00d2ff },
        { type: 'sniper',  pos: [hx - 2.5, 1.3, hz - 2.5], color: 0xff007f },
        { type: 'ak47',    pos: [hx + 2.5, 1.3, hz],       color: 0xffaa00 },
        { type: 'knife',   pos: [hx + 2.5, 1.3, hz - 2.5], color: 0xffaa00 },
    ];

    for (const def of pickupDefs) {
        createWeaponPickup(def.type, def.pos, def.color);
    }
}

function createWeaponPickup(type, position, color) {
    const group = new THREE.Group();

    // Base platform (glowing pedestal)
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.15, 16);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8, roughness: 0.2 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.4, 0);
    group.add(base);

    // Glowing ring on pedestal
    const ringGeo = new THREE.TorusGeometry(0.5, 0.03, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: color });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, -0.32, 0);
    group.add(ring);

    // Weapon model (simplified floating version)
    if (type === 'pistol') {
        const gunGeo = new THREE.BoxGeometry(0.15, 0.12, 0.5);
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
        const gun = new THREE.Mesh(gunGeo, gunMat);
        group.add(gun);
        const accent = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.5), new THREE.MeshBasicMaterial({ color: color }));
        accent.position.y = 0.07;
        group.add(accent);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        grip.position.set(0, -0.12, 0.1);
        grip.rotation.x = -0.3;
        group.add(grip);
    } else if (type === 'smg') {
        const gunGeo = new THREE.BoxGeometry(0.14, 0.14, 0.7);
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7 });
        const gun = new THREE.Mesh(gunGeo, gunMat);
        group.add(gun);
        const accent = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: color }));
        accent.position.y = 0.08;
        group.add(accent);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.06), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
        mag.position.set(0, -0.12, 0);
        group.add(mag);
    } else if (type === 'sniper') {
        const gunGeo = new THREE.BoxGeometry(0.12, 0.12, 1.0);
        const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9 });
        const gun = new THREE.Mesh(gunGeo, gunMat);
        group.add(gun);
        const accent = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.015, 1.0), new THREE.MeshBasicMaterial({ color: color }));
        accent.position.y = 0.07;
        group.add(accent);
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
        scope.position.set(0, 0.12, -0.1);
        group.add(scope);
    } else if (type === 'knife') {
        const bladeGeo = new THREE.BoxGeometry(0.06, 0.04, 0.5);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        group.add(blade);
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.06), new THREE.MeshStandardMaterial({ color: 0x553300 }));
        handle.position.set(0, -0.06, 0.25);
        group.add(handle);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: color }));
        guard.position.set(0, 0, 0.2);
        group.add(guard);
    } else if (type === 'ak47') {
        const bodyGeo = new THREE.BoxGeometry(0.1, 0.1, 0.6);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        group.add(body);
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x5a3e2b }));
        stock.position.set(0, -0.02, 0.4);
        group.add(stock);
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        mag.position.set(0, -0.15, -0.05);
        mag.rotation.x = 0.3;
        group.add(mag);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        barrel.rotation.x = Math.PI/2;
        barrel.position.set(0, 0, -0.4);
        group.add(barrel);
    }

    // Glow light
    const glow = new THREE.PointLight(color, 1.5, 5);
    glow.position.set(0, 0.3, 0);
    group.add(glow);

    group.position.set(...position);
    scene.add(group);

    weaponPickups.push({
        group: group,
        type: type,
        color: color,
        position: new THREE.Vector3(...position),
        active: true,
        respawnTimer: 0,
        originalY: position[1]
    });
}

function updatePickups(delta, time) {
    const playerPos = controls.getObject().position;
    let nearestPickup = null;
    let nearestDist = Infinity;

    // Door Button Check
    const hx = 25, hz = 25, hd = 8;
    const btnPos = new THREE.Vector3(hx - 2, 1.5, hz - hd / 2 - 0.3);
    const distToBtn = playerPos.distanceTo(btnPos);
    
    const prompt = document.getElementById('pickup-prompt');
    
    if (distToBtn < 2.5) {
        if (prompt) {
            prompt.textContent = `[E] ${doorOpen ? 'Fechar Porta' : 'Abrir Porta'}`;
            prompt.style.display = 'block';
        }
        if (pickupPressed) {
            pickupPressed = false;
            toggleDoor();
        }
        return; // Don't show weapon pick prompt if near button
    }

    for (const pickup of weaponPickups) {
        if (!pickup.active) {
            pickup.respawnTimer -= delta;
            if (pickup.respawnTimer <= 0) {
                pickup.active = true;
                pickup.group.visible = true;
            }
            continue;
        }

        // Floating animation
        const floatY = pickup.originalY + Math.sin(time * 0.002 + weaponPickups.indexOf(pickup) * 1.5) * 0.15;
        pickup.group.position.y = floatY;

        // Rotation animation
        pickup.group.rotation.y += delta * 1.2;

        // Check distance to player
        const dist = playerPos.distanceTo(pickup.group.position);
        if (dist < PICKUP_RANGE && dist < nearestDist) {
            nearestDist = dist;
            nearestPickup = pickup;
        }
    }

    // Show/hide pickup prompt
    if (nearestPickup && prompt) {
        const w = weapons[nearestPickup.type];
        prompt.textContent = `[E] Pegar ${w.name} (${w.key})`;
        prompt.style.display = 'block';
    } else if (prompt) {
        prompt.style.display = 'none';
    }

    // Check for pickup key press
    if (nearestPickup && pickupPressed) {
        pickupPressed = false;
        // Switch to picked weapon and refill ammo
        switchWeapon(nearestPickup.type);
        currentWeapon.ammo = currentWeapon.maxAmmo;
        updateUI();

        // Deactivate pickup
        nearestPickup.active = false;
        nearestPickup.group.visible = false;
        nearestPickup.respawnTimer = PICKUP_RESPAWN_TIME;

        // Visual feedback
        createImpact(nearestPickup.position.clone().add(new THREE.Vector3(0, 0.5, 0)), nearestPickup.color);
    }
}

let pickupPressed = false;

// ========================
// STAIRS
// ========================
function createStairs() {
    const stairCount = 10;
    const stepWidth = 4;
    const stepDepth = 1.2;
    const stepHeight = 0.5;
    const startX = -ARENA_SIZE + 5;
    const startZ = -ARENA_SIZE + 3;

    const stairMat = new THREE.MeshStandardMaterial({ color: 0x444466, roughness: 0.4 });

    for (let i = 0; i < stairCount; i++) {
        const geo = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
        const mesh = new THREE.Mesh(geo, stairMat);
        const y = stepHeight / 2 + i * stepHeight;
        const z = startZ + i * stepDepth;
        mesh.position.set(startX, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        const box = new THREE.Box3().setFromObject(mesh);
        colliders.push(box);
        floorSegments.push({ box3: box, topY: y + stepHeight / 2 });
    }

    // Platform at top of stairs
    const platGeo = new THREE.BoxGeometry(8, 0.5, 8);
    const platMesh = new THREE.Mesh(platGeo, new THREE.MeshStandardMaterial({ color: 0x555577 }));
    const platY = stairCount * stepHeight;
    platMesh.position.set(startX, platY + 0.25, startZ + stairCount * stepDepth + 3);
    platMesh.castShadow = true;
    platMesh.receiveShadow = true;
    scene.add(platMesh);

    const platBox = new THREE.Box3().setFromObject(platMesh);
    colliders.push(platBox);
    floorSegments.push({ box3: platBox, topY: platY + 0.5 });

    // Railing (visual)
    const railMat = new THREE.MeshBasicMaterial({ color: 0x00ff7f });
    for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < stairCount; i++) {
            const railGeo = new THREE.BoxGeometry(0.1, 1, 0.1);
            const rail = new THREE.Mesh(railGeo, railMat);
            const y = stepHeight / 2 + i * stepHeight + 0.5;
            const z = startZ + i * stepDepth;
            rail.position.set(startX + side * (stepWidth / 2), y, z);
            scene.add(rail);
        }
    }

    // Label
    const labelGeo = new THREE.BoxGeometry(0.1, 1, 3);
    const labelMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.set(startX - stepWidth / 2 - 0.5, 1.5, startZ + 1);
    scene.add(label);
}

// ========================
// WEAPON MODELS (First Person)
// ========================
function createWeaponModel(type) {
    // Remove old weapon
    if (weaponGroup) camera.remove(weaponGroup);

    weaponGroup = new THREE.Group();
    const color = weapons[type].color;

    if (type === 'knife') {
        // Blade
        const bladeGeo = new THREE.BoxGeometry(0.03, 0.02, 0.35);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.set(0, 0, -0.2);
        weaponGroup.add(blade);

        // Blade edge (thin line)
        const edgeGeo = new THREE.BoxGeometry(0.005, 0.025, 0.35);
        const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.position.set(0.018, 0, -0.2);
        weaponGroup.add(edge);

        // Handle
        const handleGeo = new THREE.BoxGeometry(0.04, 0.12, 0.04);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x553300 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(0, -0.06, -0.01);
        weaponGroup.add(handle);

        // Guard
        const guardGeo = new THREE.BoxGeometry(0.08, 0.02, 0.02);
        const guardMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.8 });
        const guard = new THREE.Mesh(guardGeo, guardMat);
        guard.position.set(0, 0, -0.02);
        weaponGroup.add(guard);

        weaponGroup.position.set(0.35, -0.25, -0.4);
        weaponGroup.rotation.set(0.3, -0.2, -0.4);

    } else if (type === 'pistol') {
        // Slide
        const slideGeo = new THREE.BoxGeometry(0.06, 0.06, 0.3);
        const slideMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 });
        const slide = new THREE.Mesh(slideGeo, slideMat);
        slide.position.set(0, 0.03, -0.1);
        weaponGroup.add(slide);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.08, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.03, -0.29);
        weaponGroup.add(barrel);

        // Grip
        const gripGeo = new THREE.BoxGeometry(0.05, 0.12, 0.06);
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.04, 0.02);
        grip.rotation.x = -0.2;
        weaponGroup.add(grip);

        // Trigger
        const trigGeo = new THREE.BoxGeometry(0.01, 0.04, 0.02);
        const trigMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
        const trig = new THREE.Mesh(trigGeo, trigMat);
        trig.position.set(0, -0.01, -0.02);
        weaponGroup.add(trig);

        // Glow accent
        const accentGeo = new THREE.BoxGeometry(0.065, 0.01, 0.3);
        const accentMat = new THREE.MeshBasicMaterial({ color: color });
        const accent = new THREE.Mesh(accentGeo, accentMat);
        accent.position.set(0, 0.065, -0.1);
        weaponGroup.add(accent);

        weaponGroup.position.set(0.32, -0.3, -0.45);
        weaponGroup.rotation.set(0, 0.05, 0);

    } else if (type === 'smg') {
        // Body
        const bodyGeo = new THREE.BoxGeometry(0.07, 0.07, 0.45);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.3 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 0.02, -0.15);
        weaponGroup.add(body);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.15, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.44);
        weaponGroup.add(barrel);

        // Magazine
        const magGeo = new THREE.BoxGeometry(0.04, 0.15, 0.04);
        const magMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const mag = new THREE.Mesh(magGeo, magMat);
        mag.position.set(0, -0.06, -0.08);
        mag.rotation.x = -0.15;
        weaponGroup.add(mag);

        // Grip
        const gripGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05);
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.04, 0.08);
        grip.rotation.x = -0.3;
        weaponGroup.add(grip);

        // Stock
        const stockGeo = new THREE.BoxGeometry(0.05, 0.05, 0.18);
        const stockMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const stock = new THREE.Mesh(stockGeo, stockMat);
        stock.position.set(0, 0.02, 0.16);
        weaponGroup.add(stock);

        // Glow strips
        const stripGeo = new THREE.BoxGeometry(0.075, 0.01, 0.45);
        const stripMat = new THREE.MeshBasicMaterial({ color: color });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, 0.06, -0.15);
        weaponGroup.add(strip);

        weaponGroup.position.set(0.3, -0.3, -0.4);

    } else if (type === 'sniper') {
        // Body/Stock
        const bodyGeo = new THREE.BoxGeometry(0.06, 0.06, 0.7);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.2 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 0.02, -0.25);
        weaponGroup.add(body);

        // Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.75);
        weaponGroup.add(barrel);

        // Larger Scope
        const scopeGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12);
        const scopeMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.9 });
        const scope = new THREE.Mesh(scopeGeo, scopeMat);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.09, -0.25);
        weaponGroup.add(scope);

        // Scope details (rings)
        const ringGeo = new THREE.TorusGeometry(0.038, 0.005, 8, 16);
        const ringMat = new THREE.MeshBasicMaterial({ color: color });
        const r1 = new THREE.Mesh(ringGeo, ringMat); r1.position.set(0, 0.09, -0.32); r1.rotation.y = Math.PI/2; weaponGroup.add(r1);
        const r2 = new THREE.Mesh(ringGeo, ringMat); r2.position.set(0, 0.09, -0.18); r2.rotation.y = Math.PI/2; weaponGroup.add(r2);

        // Lens Glow
        const lensGeo = new THREE.SphereGeometry(0.03, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        const lensMat = new THREE.MeshBasicMaterial({ color: color });
        const lens = new THREE.Mesh(lensGeo, lensMat);
        lens.position.set(0, 0.09, -0.36);
        lens.rotation.x = -Math.PI / 2;
        weaponGroup.add(lens);

        // Grip
        const gripGeo = new THREE.BoxGeometry(0.04, 0.12, 0.04);
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const grip = new THREE.Mesh(gripGeo, gripMat);
        grip.position.set(0, -0.05, 0.05);
        grip.rotation.x = -0.3;
        weaponGroup.add(grip);

        weaponGroup.position.set(0.3, -0.35, -0.5);

    } else if (type === 'ak47') {
        // Main Body (Metal)
        const bodyGeo = new THREE.BoxGeometry(0.06, 0.08, 0.5);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x242424, metalness: 0.8, roughness: 0.3 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 0.02, -0.2);
        weaponGroup.add(body);

        // Wood Stock
        const stockGeo = new THREE.BoxGeometry(0.05, 0.1, 0.25);
        const stockMat = new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.8 });
        const stock = new THREE.Mesh(stockGeo, stockMat);
        stock.position.set(0, 0, 0.15);
        weaponGroup.add(stock);

        // Wood Grip (Handguard)
        const handGeo = new THREE.BoxGeometry(0.065, 0.05, 0.2);
        const hand = new THREE.Mesh(handGeo, stockMat);
        hand.position.set(0, -0.01, -0.35);
        weaponGroup.add(hand);

        // Metal Barrel
        const barrelGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8);
        const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
        const barrel = new THREE.Mesh(barrelGeo, barrelMat);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0, 0.02, -0.55);
        weaponGroup.add(barrel);

        // Gas tube
        const gasGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.25, 8);
        const gas = new THREE.Mesh(gasGeo, barrelMat);
        gas.rotation.x = Math.PI / 2;
        gas.position.set(0, 0.05, -0.4);
        weaponGroup.add(gas);

        // Handle
        const handleGeo = new THREE.BoxGeometry(0.04, 0.1, 0.04);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.9 });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        handle.position.set(0, -0.06, -0.05);
        handle.rotation.x = -0.4;
        weaponGroup.add(handle);

        // Curved Magazine
        const magGroup = new THREE.Group();
        const magPart1 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.15, 0.05), bodyMat);
        magPart1.position.set(0, -0.1, -0.15);
        magPart1.rotation.x = 0.2;
        magGroup.add(magPart1);
        weaponGroup.add(magGroup);

        // Glow
        const glowGeo = new THREE.BoxGeometry(0.065, 0.005, 0.4);
        const glowMat = new THREE.MeshBasicMaterial({ color: color });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(0, 0.062, -0.2);
        weaponGroup.add(glow);

        weaponGroup.position.set(0.32, -0.32, -0.45);
    }
    camera.add(weaponGroup);
}

// ========================
// WEAPON LOGIC
// ========================
function switchWeapon(type) {
    currentWeapon = weapons[type];
    currentWeaponKey = type;
    createWeaponModel(type);
    document.getElementById('weapon-info').textContent = currentWeapon.name;
    isADS = false; // Reset ADS on switch
    adsLerp = 0;
    updateUI();
}

// ========================
// ADVANCED MECHANICS
// ========================

function startDash() {
    if (isDashing || dashTimer > 0) return;
    
    // Get dash direction from inputs
    dashDir.set(0, 0, 0);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    
    const dirZ = Number(moveForward) - Number(moveBackward);
    const dirX = Number(moveRight) - Number(moveLeft);
    
    if (dirZ !== 0 || dirX !== 0) {
        dashDir.addScaledVector(forward, dirZ);
        dashDir.addScaledVector(right, dirX);
    } else {
        // Default to forward if no input
        dashDir.copy(forward);
    }
    dashDir.normalize();
    
    isDashing = true;
    dashTimer = DASH_DURATION;
    
    // Screen shake on dash
    screenShake = Math.max(screenShake, 0.05);
}

function handleScreenShake(camera, delta) {
    if (screenShake > 0) {
        const shake = screenShake;
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        camera.position.z += (Math.random() - 0.5) * shake;
        screenShake *= Math.pow(0.01, delta); // decay
        if (screenShake < 0.001) screenShake = 0;
    }
}

function playFootstepSound(material) {
    if (!footstepAudioCtx) {
        footstepAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (footstepAudioCtx.state === 'suspended') {
        footstepAudioCtx.resume();
    }

    const osc = footstepAudioCtx.createOscillator();
    const gain = footstepAudioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(footstepAudioCtx.destination);
    
    const now = footstepAudioCtx.currentTime;
    
    if (material === 'metal') {
        // High frequency "clink"
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        gain.gain.setValueAtTime(0.05, now);
    } else {
        // Low frequency "thud" for wood/concrete
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(20, now + 0.15);
        gain.gain.setValueAtTime(0.1, now);
    }
    
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc.start(now);
    osc.stop(now + 0.2);
}

function reloadWeapon() {
    if (currentWeapon.isKnife || isReloading) return;
    if (currentWeapon.ammo === currentWeapon.maxAmmo) return;
    
    isReloading = true;
    reloadTimer = 1.5; // 1.5 seconds reload
    
    // Animate reload
    if (weaponGroup) {
        weaponGroup.rotation.z += 0.5;
        weaponGroup.position.y -= 0.2;
        setTimeout(() => {
            if (weaponGroup) {
                weaponGroup.rotation.z -= 0.5;
                weaponGroup.position.y += 0.2;
                currentWeapon.ammo = currentWeapon.maxAmmo;
                updateUI();
            }
        }, 1500);
    } else {
        currentWeapon.ammo = currentWeapon.maxAmmo;
        updateUI();
    }
}

function fire() {
    if (isReloading) return;
    const now = performance.now();
    if (now - lastFireTime < currentWeapon.fireRate) return;

    if (currentWeapon.isKnife) {
        lastFireTime = now;
        knifeAttack();
        // Knife swing anim
        if (weaponGroup) {
            weaponGroup.rotation.x -= 0.6;
            setTimeout(() => { if (weaponGroup) weaponGroup.rotation.x += 0.6; }, 150);
        }
        return;
    }

    if (currentWeapon.ammo <= 0) return;

    lastFireTime = now;
    currentWeapon.ammo--;
    updateUI();

    // Recoil animation & Shake
    if (weaponGroup) {
        weaponGroup.position.z += currentWeapon.recoil * 2;
        weaponGroup.rotation.x -= currentWeapon.recoil;
        screenShake = Math.max(screenShake, currentWeapon.recoil * 0.5);
        setTimeout(() => {
            if (weaponGroup) {
                weaponGroup.position.z -= currentWeapon.recoil * 2;
                weaponGroup.rotation.x += currentWeapon.recoil;
            }
        }, 60);
    }

    // Visual Muzzle Flash
    const flash = new THREE.PointLight(currentWeapon.color, 15, 6);
    flash.position.set(0.32, -0.25, -0.85);
    camera.add(flash);
    setTimeout(() => camera.remove(flash), 40);

    // Hitscan with dynamic spread
    const spread = currentWeapon.spread * (1.0 + velocity.length() * 0.15) * (isCrouching ? 0.5 : 1.0);
    const raycaster = new THREE.Raycaster();
    const target = new THREE.Vector3(0, 0, -1);
    target.x += (Math.random() - 0.5) * spread;
    target.y += (Math.random() - 0.5) * spread;
    target.applyQuaternion(camera.quaternion);
    
    raycaster.set(camera.position, target);

    // Filter bots
    const botMeshParts = [];
    bots.filter(b => b.alive).forEach(b => {
        b.mesh.traverse(child => { if (child.isMesh) botMeshParts.push({ mesh: child, bot: b }); });
    });

    const allBotMeshes = botMeshParts.map(bp => bp.mesh);
    
    // Check world collision first
    const worldIntersects = raycaster.intersectObjects(scene.children, true);
    let firstWorldHit = null;
    for (const hit of worldIntersects) {
        // Skip certain objects if needed, but normally check all geometry
        if (hit.object.type === 'Mesh') {
            firstWorldHit = hit;
            break;
        }
    }

    // Check bot hits
    const botIntersects = raycaster.intersectObjects(allBotMeshes, false);
    
    if (botIntersects.length > 0) {
        const botHit = botIntersects[0];
        // If world hit is closer than bot hit, it's a wall hit
        if (firstWorldHit && firstWorldHit.distance < botHit.distance) {
            createImpact(firstWorldHit.point, currentWeapon.color);
        } else {
            const hitObj = botHit.object;
            createImpact(botHit.point, currentWeapon.color);
            for (const bp of botMeshParts) {
                if (bp.mesh === hitObj) {
                    damageBot(bp.bot, currentWeapon.damage);
                    break;
                }
            }
        }
    } else if (firstWorldHit) {
        createImpact(firstWorldHit.point, currentWeapon.color);
    }
}

function knifeAttack() {
    const playerPos = controls.getObject().position;
    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);

    for (const bot of bots) {
        if (!bot.alive) continue;
        const botPos = bot.mesh.position.clone();
        botPos.y = playerPos.y;
        const dist = playerPos.distanceTo(botPos);

        if (dist < currentWeapon.range) {
            const toBot = botPos.clone().sub(playerPos).normalize();
            const dot = cameraDir.dot(toBot);
            if (dot > 0.4) {
                damageBot(bot, currentWeapon.damage);
                // For knife, impact normal can be player's forward direction or just upward
                createImpact(bot.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), cameraDir);
                break;
            }
        }
    }
}

function createImpact(point, normal) {
    // Basic point
    const geo = new THREE.SphereGeometry(0.04, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: currentWeapon.color });
    const impact = new THREE.Mesh(geo, mat);
    impact.position.copy(point).add(normal.clone().multiplyScalar(0.01));
    scene.add(impact);
    setTimeout(() => scene.remove(impact), 2000);

    // Particles (Sparks/Smoke)
    for (let i = 0; i < 6; i++) {
        const pGeo = new THREE.BoxGeometry(0.015, 0.015, 0.015);
        const pMat = new THREE.MeshBasicMaterial({ color: currentWeapon.color });
        const p = new THREE.Mesh(pGeo, pMat);
        p.position.copy(point);
        
        const force = 0.05 + Math.random() * 0.1;
        const pVel = normal.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 1,
            (Math.random() - 0.5) * 1,
            (Math.random() - 0.5) * 1
        )).normalize().multiplyScalar(force);
        
        scene.add(p);
        
        let pLife = 0;
        const pInterval = setInterval(() => {
            p.position.add(pVel);
            p.scale.multiplyScalar(0.9);
            pLife++;
            if (pLife > 20) {
                clearInterval(pInterval);
                scene.remove(p);
            }
        }, 16);
    }
}

// ========================
// BOTS
// ========================
function createBotMesh() {
    const group = new THREE.Group();

    const bodyGeo = new THREE.BoxGeometry(0.8, 1.2, 0.5);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x330000, emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xff5555, emissive: 0x440000, emissiveIntensity: 0.5 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.75;
    group.add(head);

    const eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 1.8, 0.2);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.1, 1.8, 0.2);
    group.add(eyeR);

    const armGeo = new THREE.BoxGeometry(0.2, 0.8, 0.2);
    const armMat = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
    const armL = new THREE.Mesh(armGeo, armMat);
    armL.position.set(-0.5, 0.9, 0);
    group.add(armL);
    const armR = new THREE.Mesh(armGeo, armMat);
    armR.position.set(0.5, 0.9, 0);
    group.add(armR);

    const legGeo = new THREE.BoxGeometry(0.25, 0.7, 0.25);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x991111 });
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-0.2, 0.15, 0);
    group.add(legL);
    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(0.2, 0.15, 0);
    group.add(legR);

    // HP bar background
    const hpBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide })
    );
    hpBg.position.y = 2.15;
    group.add(hpBg);

    // HP bar fill
    const hpFill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
    );
    hpFill.position.y = 2.16;
    hpFill.name = 'hpBar';
    group.add(hpFill);

    // Bot weapon (small gun in right hand)
    const gunGeo = new THREE.BoxGeometry(0.08, 0.08, 0.3);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8 });
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.55, 0.95, 0.2);
    gun.name = 'botGun';
    group.add(gun);

    // Gun glow tip
    const tipGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0.55, 0.95, 0.38);
    tip.name = 'gunTip';
    group.add(tip);

    // Detection range indicator (subtle circle around the bot)
    const rangeGeo = new THREE.RingGeometry(BOT_DETECTION_RANGE - 0.1, BOT_DETECTION_RANGE, 32);
    const rangeMat = new THREE.MeshBasicMaterial({
        color: 0xff3333,
        transparent: true,
        opacity: 0.03,
        side: THREE.DoubleSide
    });
    const rangeRing = new THREE.Mesh(rangeGeo, rangeMat);
    rangeRing.rotation.x = -Math.PI / 2;
    rangeRing.position.y = 0.03;
    rangeRing.name = 'detectionRing';
    group.add(rangeRing);

    return group;
}

function spawnBots() {
    for (let i = 0; i < BOT_COUNT; i++) {
        const mesh = createBotMesh();
        const angle = (i / BOT_COUNT) * Math.PI * 2;
        const r = 15 + Math.random() * (ARENA_SIZE - 20);
        mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        scene.add(mesh);

        bots.push({
            mesh, health: BOT_HEALTH, maxHealth: BOT_HEALTH,
            speed: BOT_SPEED * (0.8 + Math.random() * 0.4),
            lastAttackTime: 0, alive: true, respawnTimer: 0,
            state: 'idle', // idle, chase, attack
            idleTarget: new THREE.Vector3(
                (Math.random() - 0.5) * ARENA_SIZE * 1.5,
                0,
                (Math.random() - 0.5) * ARENA_SIZE * 1.5
            ),
            idleTimer: 0,
            shootFlashTimer: 0
        });
    }
}

function respawnBot(bot) {
    bot.health = BOT_HEALTH;
    bot.alive = true;
    bot.mesh.visible = true;
    bot.state = 'idle';
    const angle = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * (ARENA_SIZE - 20);
    bot.mesh.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    bot.idleTarget.set(
        (Math.random() - 0.5) * ARENA_SIZE * 1.5,
        0,
        (Math.random() - 0.5) * ARENA_SIZE * 1.5
    );

    const hpBar = bot.mesh.getObjectByName('hpBar');
    if (hpBar) { hpBar.scale.x = 1; hpBar.material.color.setHex(0x00ff00); }
}

function damageBot(bot, damage) {
    bot.health -= damage;
    const hpBar = bot.mesh.getObjectByName('hpBar');
    if (hpBar) {
        const ratio = Math.max(0, bot.health / bot.maxHealth);
        hpBar.scale.x = ratio;
        if (ratio > 0.5) hpBar.material.color.setHex(0x00ff00);
        else if (ratio > 0.25) hpBar.material.color.setHex(0xffff00);
        else hpBar.material.color.setHex(0xff0000);
    }
    if (bot.health <= 0) killBot(bot);
}

function killBot(bot) {
    bot.alive = false;
    bot.mesh.visible = false;
    bot.respawnTimer = 5;
    kills++;
    updateKillsUI();
}

// ========================
// BOT SHOOTING (Projectiles)
// ========================
function botShoot(bot) {
    const playerPos = controls.getObject().position;
    const botPos = bot.mesh.position;

    // Calculate shoot origin (from bot gun tip)
    const gunTip = bot.mesh.getObjectByName('gunTip');
    let shootOrigin;
    if (gunTip) {
        shootOrigin = new THREE.Vector3();
        gunTip.getWorldPosition(shootOrigin);
    } else {
        shootOrigin = new THREE.Vector3(botPos.x, botPos.y + 1.0, botPos.z);
    }

    // Calculate direction to player with slight inaccuracy
    const targetPos = playerPos.clone();
    targetPos.x += (Math.random() - 0.5) * 1.5; // random inaccuracy
    targetPos.y += (Math.random() - 0.5) * 0.8;
    targetPos.z += (Math.random() - 0.5) * 1.5;

    const bulletDir = targetPos.clone().sub(shootOrigin).normalize();

    // Create bullet mesh
    const bulletGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    const bullet = new THREE.Mesh(bulletGeo, bulletMat);
    bullet.position.copy(shootOrigin);
    scene.add(bullet);

    // Bullet trail (glowing line)
    const trailGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4);
    const trailMat = new THREE.MeshBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.7 });
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.copy(shootOrigin);
    scene.add(trail);

    // Muzzle flash on bot
    bot.shootFlashTimer = 0.1;
    const tipMesh = bot.mesh.getObjectByName('gunTip');
    if (tipMesh) {
        tipMesh.material.color.setHex(0xffff00);
        setTimeout(() => {
            if (tipMesh) tipMesh.material.color.setHex(0xff4444);
        }, 100);
    }

    botBullets.push({
        mesh: bullet,
        trail: trail,
        direction: bulletDir,
        speed: BOT_BULLET_SPEED,
        damage: BOT_DAMAGE,
        life: 3.0, // seconds before auto-destroy
        origin: shootOrigin.clone()
    });
}

function updateBotBullets(delta) {
    const playerPos = controls.getObject().position;

    for (let i = botBullets.length - 1; i >= 0; i--) {
        const b = botBullets[i];
        b.life -= delta;

        // Move bullet
        b.mesh.position.addScaledVector(b.direction, b.speed * delta);

        // Update trail position to follow bullet
        b.trail.position.copy(b.mesh.position);
        b.trail.position.addScaledVector(b.direction, -0.2);
        // Orient trail along direction
        b.trail.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            b.direction
        );

        // Check hit player (sphere around player)
        const distToPlayer = b.mesh.position.distanceTo(playerPos);
        if (distToPlayer < 0.8 && controls.isLocked) {
            // Hit player!
            playerHealth -= b.damage;
            if (playerHealth < 0) playerHealth = 0;
            updateHealthUI();
            screenShake = Math.max(screenShake, 0.15); // Hit shake
            flashDamage();
            // For bot bullet hit on player, normal can be bullet direction
            createImpact(b.mesh.position.clone(), b.direction.clone().negate());

            // Remove bullet
            scene.remove(b.mesh);
            scene.remove(b.trail);
            botBullets.splice(i, 1);

            if (playerHealth <= 0) handlePlayerDeath();
            continue;
        }

        // Check world collision (walls)
        const bulletBox = new THREE.Box3().setFromCenterAndSize(b.mesh.position, new THREE.Vector3(0.2, 0.2, 0.2));
        let hitWorld = false;
        for (const wall of colliders) {
            if (bulletBox.intersectsBox(wall)) {
                hitWorld = true;
                break;
            }
        }

        if (hitWorld) {
            // For bot bullet hit on world, we don't have a face normal, use bullet direction
            createImpact(b.mesh.position.clone(), b.direction.clone().negate());
            scene.remove(b.mesh);
            scene.remove(b.trail);
            botBullets.splice(i, 1);
            continue;
        }

        // Check out of bounds or life expired
        if (b.life <= 0 ||
            Math.abs(b.mesh.position.x) > ARENA_SIZE + 2 ||
            Math.abs(b.mesh.position.z) > ARENA_SIZE + 2 ||
            b.mesh.position.y < -1 ||
            b.mesh.position.y > CEILING_HEIGHT + 1) {
            scene.remove(b.mesh);
            scene.remove(b.trail);
            botBullets.splice(i, 1);
            continue;
        }

        // Check hit walls/cover (simple distance check from origin)
        const distTraveled = b.mesh.position.distanceTo(b.origin);
        if (distTraveled > BOT_SHOOT_RANGE * 1.5) {
            scene.remove(b.mesh);
            scene.remove(b.trail);
            botBullets.splice(i, 1);
        }
    }
}

// ========================
// BOT AI UPDATE
// ========================
function updateBots(delta, time) {
    const playerPos = controls.getObject().position;

    for (const bot of bots) {
        if (!bot.alive) {
            bot.respawnTimer -= delta;
            if (bot.respawnTimer <= 0) respawnBot(bot);
            continue;
        }

        const botPos = bot.mesh.position;
        const dx = playerPos.x - botPos.x;
        const dz = playerPos.z - botPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // --- STATE MACHINE ---
        // Determine state based on distance to player
        if (dist <= BOT_DETECTION_RANGE) {
            // Player is within detection range
            if (dist <= BOT_ATTACK_RANGE) {
                bot.state = 'attack'; // close enough for melee
            } else {
                bot.state = 'chase'; // chase and shoot
            }
        } else {
            bot.state = 'idle'; // player too far, patrol
        }

        // --- Update detection ring opacity based on state ---
        const ring = bot.mesh.getObjectByName('detectionRing');
        if (ring) {
            if (bot.state === 'idle') {
                ring.material.opacity = 0.02;
                ring.material.color.setHex(0x333333);
            } else if (bot.state === 'chase') {
                ring.material.opacity = 0.06;
                ring.material.color.setHex(0xff6600);
            } else {
                ring.material.opacity = 0.1;
                ring.material.color.setHex(0xff0000);
            }
        }

        // --- Eye glow based on state ---
        const eyeColor = bot.state === 'idle' ? 0x666600 :
                          bot.state === 'chase' ? 0xff6600 : 0xff0000;
        if (bot.mesh.children[2] && bot.mesh.children[2].material) {
            bot.mesh.children[2].material.color.setHex(eyeColor);
        }
        if (bot.mesh.children[3] && bot.mesh.children[3].material) {
            bot.mesh.children[3].material.color.setHex(eyeColor);
        }

        // --- BEHAVIOR BASED ON STATE ---
        if (bot.state === 'idle') {
            // IDLE: Patrol randomly
            const toTarget = bot.idleTarget.clone().sub(botPos);
            toTarget.y = 0;
            const distToTarget = toTarget.length();

            if (distToTarget < 2) {
                // Pick new random target
                bot.idleTarget.set(
                    (Math.random() - 0.5) * ARENA_SIZE * 1.5,
                    0,
                    (Math.random() - 0.5) * ARENA_SIZE * 1.5
                );
            } else {
                // Move towards idle target (slower pace)
                const idleMoveSpeed = bot.speed * 0.4;
                const moveDir = toTarget.normalize();
                const stepX = moveDir.x * idleMoveSpeed * delta;
                const stepZ = moveDir.z * idleMoveSpeed * delta;
                
                // Bot collision check - Separate X/Z for sliding
                const checkBotCollision = (nx, nz) => {
                    const botBox = new THREE.Box3().setFromCenterAndSize(
                        new THREE.Vector3(nx, 1, nz),
                        new THREE.Vector3(1, 2, 1)
                    );
                    for (const wall of colliders) {
                        if (botBox.intersectsBox(wall)) return true;
                    }
                    return false;
                };

                if (!checkBotCollision(botPos.x + stepX, botPos.z)) {
                    botPos.x += stepX;
                }
                if (!checkBotCollision(botPos.x, botPos.z + stepZ)) {
                    botPos.z += stepZ;
                }
                // Look in movement direction
                bot.mesh.lookAt(botPos.x + moveDir.x, 0, botPos.z + moveDir.z);
            }

        } else if (bot.state === 'chase') {
            // CHASE: Move towards player and shoot
            const moveX = (dx / dist) * bot.speed * delta;
            const moveZ = (dz / dist) * bot.speed * delta;
            
            // Bot collision check - Separate X/Z for sliding
            const checkBotCollision = (nx, nz) => {
                const botBox = new THREE.Box3().setFromCenterAndSize(
                    new THREE.Vector3(nx, 1, nz),
                    new THREE.Vector3(1, 2, 1)
                );
                for (const wall of colliders) {
                    if (botBox.intersectsBox(wall)) return true;
                }
                return false;
            };

            if (!checkBotCollision(botPos.x + moveX, botPos.z)) {
                botPos.x += moveX;
            }
            if (!checkBotCollision(botPos.x, botPos.z + moveZ)) {
                botPos.z += moveZ;
            }

            // Look at player
            bot.mesh.lookAt(playerPos.x, 0, playerPos.z);

            // Shoot at player if within shoot range
            if (dist <= BOT_SHOOT_RANGE && controls.isLocked) {
                const now = performance.now();
                if (now - bot.lastAttackTime > BOT_ATTACK_COOLDOWN) {
                    bot.lastAttackTime = now;
                    botShoot(bot);
                }
            }

        } else if (bot.state === 'attack') {
            // ATTACK: Very close, melee + shoot
            bot.mesh.lookAt(playerPos.x, 0, playerPos.z);

            if (controls.isLocked) {
                const now = performance.now();
                if (now - bot.lastAttackTime > BOT_ATTACK_COOLDOWN) {
                    bot.lastAttackTime = now;
                    // Melee damage at close range
                    playerHealth -= BOT_DAMAGE;
                    if (playerHealth < 0) playerHealth = 0;
                    updateHealthUI();
                    screenShake = Math.max(screenShake, 0.15); // Hit shake
                    flashDamage();
                    if (playerHealth <= 0) handlePlayerDeath();
                }
            }
        }

        // Animate legs
        const legSpeed = bot.state !== 'idle' ? 8 : 3;
        const bob = Math.sin(time * 0.001 * legSpeed + bots.indexOf(bot)) * 0.1;
        if (bot.mesh.children[6]) bot.mesh.children[6].position.y = 0.15 + bob;
        if (bot.mesh.children[7]) bot.mesh.children[7].position.y = 0.15 - bob;

        // HP bar face camera
        const hpBar = bot.mesh.getObjectByName('hpBar');
        if (hpBar) hpBar.lookAt(camera.position);
        if (bot.mesh.children[8]) bot.mesh.children[8].lookAt(camera.position);
    }
}

function handlePlayerDeath() {
    playerHealth = PLAYER_MAX_HEALTH;
    kills = 0;
    controls.getObject().position.set(0, PLAYER_HEIGHT, 0);
    velocity.set(0, 0, 0);
    updateHealthUI();
    updateKillsUI();

    // Clear all bot bullets
    for (const b of botBullets) {
        scene.remove(b.mesh);
        scene.remove(b.trail);
    }
    botBullets.length = 0;

    for (const bot of bots) respawnBot(bot);
}

function flashDamage() {
    const overlay = document.getElementById('damage-overlay');
    if (overlay) {
        overlay.style.opacity = '0.4';
        setTimeout(() => overlay.style.opacity = '0', 150);
    }
}

// ========================
// COLLISION
// ========================
function getFloorHeight(x, z) {
    let maxY = 0;
    const testBox = new THREE.Box3(
        new THREE.Vector3(x - PLAYER_RADIUS, 0, z - PLAYER_RADIUS),
        new THREE.Vector3(x + PLAYER_RADIUS, PLAYER_HEIGHT, z + PLAYER_RADIUS)
    );
    for (const seg of floorSegments) {
        if (testBox.intersectsBox(seg.box3)) {
            if (seg.topY > maxY) maxY = seg.topY;
        }
    }
    return maxY;
}

function checkWallCollision(newX, newZ, currentY) {
    const playerBox = new THREE.Box3(
        new THREE.Vector3(newX - PLAYER_RADIUS, currentY - PLAYER_HEIGHT, newZ - PLAYER_RADIUS),
        new THREE.Vector3(newX + PLAYER_RADIUS, currentY + 0.2, newZ + PLAYER_RADIUS)
    );

    for (const wall of colliders) {
        if (playerBox.intersectsBox(wall)) {
            // Check if this is a floor segment we can step on
            let isFloor = false;
            for (const seg of floorSegments) {
                if (seg.box3 === wall && seg.topY <= currentY + 0.6) {
                    isFloor = true;
                    break;
                }
            }
            if (!isFloor) return true; // blocked
        }
    }
    return false; // not blocked
}

// ========================
// UI
// ========================
function updateUI() {
    if (currentWeapon.isKnife) {
        document.getElementById('ammo-count').textContent = '∞';
    } else {
        document.getElementById('ammo-count').textContent = `${currentWeapon.ammo} / ${currentWeapon.maxAmmo}`;
    }
}

function updateHealthUI() {
    const fill = document.getElementById('health-fill');
    if (fill) fill.style.width = (playerHealth / PLAYER_MAX_HEALTH) * 100 + '%';
}

function updateKillsUI() {
    const el = document.getElementById('kills-count');
    if (el) el.textContent = `Kills: ${kills}`;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========================
// GAME LOOP
// ========================
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1); // cap delta

    if (controls.isLocked) {
        // Handle Reloading
        if (isReloading) {
            reloadTimer -= delta;
            if (reloadTimer <= 0) {
                isReloading = false;
            }
        }

        // Handle ADS
        const targetAdsLerp = isADS ? 1.0 : 0.0;
        adsLerp += (targetAdsLerp - adsLerp) * 10 * delta;
        
        const fovMult = currentWeapon.hasScope ? SNIPER_FOV_MULT : ADS_FOV_MULT;
        camera.fov = BASE_FOV * (1.0 - adsLerp * (1.0 - fovMult));
        camera.updateProjectionMatrix();

        // Scope UI
        const scopeOverlay = document.getElementById('scope-overlay');
        const crosshair = document.getElementById('crosshair');
        if (currentWeapon.hasScope && adsLerp > 0.8) {
            if (scopeOverlay) scopeOverlay.style.display = 'block';
            if (crosshair) crosshair.style.display = 'none';
            if (weaponGroup) weaponGroup.visible = false;
        } else {
            if (scopeOverlay) scopeOverlay.style.display = 'none';
            if (crosshair) crosshair.style.display = 'block';
            if (weaponGroup) {
                weaponGroup.visible = true;
                // Move weapon to center during ADS for non-scoped
                if (!currentWeapon.hasScope) {
                    weaponGroup.position.x = 0.3 * (1.0 - adsLerp);
                    weaponGroup.position.y = -0.3 + (adsLerp * 0.1);
                }
            }
        }

        // Handle Dash
        if (isDashing) {
            velocity.x = dashDir.x * DASH_SPEED;
            velocity.z = dashDir.z * DASH_SPEED;
            dashTimer -= delta;
            if (dashTimer <= 0) {
                isDashing = false;
            }
        }

        const speedMult = (currentWeapon.isKnife ? KNIFE_SPEED_MULT : 1.0) * (isCrouching ? 0.5 : 1.0) * (isADS ? 0.6 : 1.0);
        const currentSpeed = MOVE_SPEED * speedMult;

        velocity.x -= velocity.x * (isDashing ? 2.0 : 10.0) * delta;
        velocity.z -= velocity.z * (isDashing ? 2.0 : 10.0) * delta;
        velocity.y -= GRAVITY * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (!isDashing) {
            if (moveForward || moveBackward) velocity.z -= direction.z * currentSpeed * 10.0 * delta;
            if (moveLeft || moveRight) velocity.x -= direction.x * currentSpeed * 10.0 * delta;
        }

        // Calculate proposed new position
        const obj = controls.getObject();
        const oldX = obj.position.x;
        const oldZ = obj.position.z;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);

        // Footsteps
        if (canJump && velocity.length() > 0.5 && !isDashing) {
            stepTimer -= delta;
            if (stepTimer <= 0) {
                // Determine material
                const hx = 25, hz = 25, hw = 10;
                const inHouse = Math.abs(obj.position.x - hx) < hw/2 && Math.abs(obj.position.z - hz) < hw/2;
                playFootstepSound(inHouse ? 'metal' : 'default');
                stepTimer = FOOTSTEP_INTERVAL * (isCrouching ? 1.5 : 1.0);
            }
        }

        // Handle Screen Shake (apply at end of position updates)
        handleScreenShake(camera, delta);

        const newX = obj.position.x;
        const newZ = obj.position.z;

        // Wall collision - try each axis independently
        if (checkWallCollision(newX, newZ, obj.position.y)) {
            // Try just X
            if (!checkWallCollision(newX, oldZ, obj.position.y)) {
                obj.position.z = oldZ;
            }
            // Try just Z
            else if (!checkWallCollision(oldX, newZ, obj.position.y)) {
                obj.position.x = oldX;
            }
            // Both blocked
            else {
                obj.position.x = oldX;
                obj.position.z = oldZ;
            }
        }

        // Arena boundary clamp (safety)
        obj.position.x = Math.max(-ARENA_SIZE + 1, Math.min(ARENA_SIZE - 1, obj.position.x));
        obj.position.z = Math.max(-ARENA_SIZE + 1, Math.min(ARENA_SIZE - 1, obj.position.z));

        // Vertical movement + floor/stairs
        obj.position.y += velocity.y * delta;

        const floorY = getFloorHeight(obj.position.x, obj.position.z);
        const targetHeight = isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
        const minY = floorY + targetHeight;

        // Lerp camera height for smooth crouch
        if (Math.abs(obj.position.y - minY) > 0.01 && canJump) {
             obj.position.y += (minY - obj.position.y) * 10 * delta;
        }

        if (obj.position.y < minY) {
            velocity.y = 0;
            obj.position.y = minY;
            canJump = true;
        }

        // Ceiling
        if (obj.position.y > CEILING_HEIGHT - 0.5) {
            obj.position.y = CEILING_HEIGHT - 0.5;
            velocity.y = 0;
        }

        // Weapon sway
        if (weaponGroup) {
            const swayAmount = 0.002;
            weaponGroup.position.x += Math.sin(time * 0.003) * swayAmount;
            weaponGroup.position.y += Math.cos(time * 0.004) * swayAmount * 0.5;
        }

        updateBots(delta, time);
        updateBotBullets(delta);
        updatePickups(delta, time);
    }

    renderer.render(scene, camera);
    prevTime = time;
}
