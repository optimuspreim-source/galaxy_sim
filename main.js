import galaxyVortexShader from "/src/shaders/vertex.glsl";
import galaxyFragmentShader from "/src/shaders/fragment.glsl";
import computeShaderVelocity from "/src/shaders/computeShaderVelocity.glsl";
import computeShaderPosition from "/src/shaders/computeShaderPosition.glsl";
import {GUI} from "dat.gui";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module";

import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";
import {GPUComputationRenderer} from "three/examples/jsm/misc/GPUComputationRenderer";
import {EffectComposer} from "three/examples/jsm/postprocessing/EffectComposer";
import {UnrealBloomPass} from "three/examples/jsm/postprocessing/UnrealBloomPass";
import {RenderPass} from "three/examples/jsm/postprocessing/RenderPass";
import {ShaderPass} from "three/examples/jsm/postprocessing/ShaderPass";
import {BlendShader} from "three/examples/jsm/shaders/BlendShader";
import {SavePass} from "three/examples/jsm/postprocessing/SavePass";
import {CopyShader} from "three/examples/jsm/shaders/CopyShader";


let container, stats;
let camera, scene, renderer, geometry, composer;

// Multiplikatoren für Simulationsgeschwindigkeit (nur Render-Loop) und Time Step
const simulationSpeedMultipliers = [5, 15, 25, 50, 100];
let simulationSpeedIndex = 0;
let simulationSpeedMultiplier = simulationSpeedMultipliers[simulationSpeedIndex];
// Black Hole Bewegungsdaten
let blackHoleVelocities = [];

const timeStepMultipliers = [1, 5, 15, 25, 50, 100];
let timeStepIndex = 0;
let baseTimeStep;

// Overlay-Element für die Anzeige
let overlay = document.createElement("div");
overlay.style.position = "fixed";
overlay.style.top = "20px";
overlay.style.left = "50%";
overlay.style.transform = "translateX(-50%)";
overlay.style.padding = "12px 32px";
overlay.style.background = "rgba(0,0,0,0.7)";
overlay.style.color = "#fff";
overlay.style.fontSize = "2em";
overlay.style.borderRadius = "12px";
overlay.style.zIndex = 9999;
overlay.style.display = "none";
document.body.appendChild(overlay);

function showOverlay(text) {
    overlay.textContent = text;
    overlay.style.display = "block";
    clearTimeout(overlay._timeout);
    overlay._timeout = setTimeout(() => {
        overlay.style.display = "none";
    }, 900);
}


let gpuCompute;
let velocityVariable;
let positionVariable;
let velocityUniforms;
let particleUniforms;
let effectController;
let particles;
let material;
let controls;
let luminosity;
let paused = false;
let autoRotation = true;
let bloom = { strength: 1.0};
let bloomPass;
// motion blur
let renderTargetParameters;
let savePass;
let blendPass;
/*--------------------------INITIALISATION-----------------------------------------------*/
const gravity = 20;
const interactionRate = 1.0;
const timeStep = 0.001;
const blackHoleForce = 100.0;
const constLuminosity = 1.0;
const numberOfStars = 30000;
const radius = 100;
const height = 5;
const middleVelocity = 2;
const velocity = 15;
const typeOfSimulation = { "Galaxie": 1, "Univers": 2, "Collision de galaxies": 3 };
renderTargetParameters = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false
};

// save pass
savePass = new SavePass(
    new THREE.WebGLRenderTarget(
        window.innerWidth,
        window.innerHeight,
        renderTargetParameters
    )
);

// blend pass
// entfernt: blackHoleStates (wurde nicht verwendet)
blendPass = new ShaderPass(BlendShader, "tDiffuse1");
blendPass.uniforms["tDiffuse2"].value = savePass.renderTarget.texture;
blendPass.uniforms["mixRatio"].value = 0.5;

// output pass
const outputPass = new ShaderPass(CopyShader);
outputPass.renderToScreen = true;

effectController = {
    // Can be changed dynamically
    gravity: 126.15,
    interactionRate: 0.019,
    timeStep: 0.01,
    blackHoleForce: 1568.0,
    luminosity: constLuminosity,
    maxAccelerationColor: 4.0,
    maxAccelerationColorPercent: 0.4,
    motionBlur: false,
    hideDarkMatter: false,

    // Must restart simulation
    numberOfStars: 241064,
    radius: 357,
    height: 5,
    middleVelocity: 2,
    velocity: 14.3,
    numberOfGalaxies: 30,
    typeOfSimulation: 1,
    autoRotation: false
};

let PARTICLES = effectController.numberOfStars;

// 1 = normal mode ; 2 = experimental mode
let selectedChoice = 1;
document.getElementById("choice1").addEventListener("click", () => selectChoice(1));
document.getElementById("choice2").addEventListener("click", () => selectChoice(2));
function selectChoice(choice) {
    selectedChoice = choice;
    document.getElementById("main-container").remove();
    if (selectedChoice === 1){
        effectController = {
            // Can be changed dynamically
            gravity: 126.15,
            interactionRate: 0.019,
            timeStep: 0.01,
            blackHoleForce: 1568.0,
            luminosity: constLuminosity,
            maxAccelerationColor: 4.0,
            maxAccelerationColorPercent: 0.4,
            motionBlur: false,
            hideDarkMatter: false,

            // Must restart simulation
            numberOfStars: 241064,
            radius: 357,
            height: 5,
            middleVelocity: 2,
            velocity: 14.3,
            numberOfGalaxies: 30,
            typeOfSimulation: 1,
            autoRotation: false
        };
    }
    init(effectController.typeOfSimulation.toString());
    animate();
}


/*-------------------------------------------------------------------------*/

/**
 *
 * @param typeOfSimulation
 */
function init(typeOfSimulation) {

    container = document.createElement( "div" );
    document.body.appendChild( container );

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.01, 1e15 );
    camera.position.x = 15;
    camera.position.y = 112;
    camera.position.z = 168;

    if (effectController.typeOfSimulation === 1) {
        camera.position.x = 0;
        camera.position.y = effectController.radius * 18;
        camera.position.z = effectController.radius * 32;
    }

    if (effectController.typeOfSimulation === 3){
        camera.position.x = 15;
        camera.position.y = 456;
        camera.position.z = 504;
    }

    if (selectedChoice === 1 && effectController.typeOfSimulation === 2){
        camera.position.x = 15;
        camera.position.y = 456;
        camera.position.z = 504;
    }


    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.appendChild( renderer.domElement );

    controls = new OrbitControls( camera, renderer.domElement );
    if (effectController.typeOfSimulation === 1 || effectController.typeOfSimulation === 3) {
        controls.autoRotate = false;
    } else if (effectController.typeOfSimulation === 2){
        controls.autoRotate = true;
        controls.autoRotateSpeed = -1.0;
    }

    initComputeRenderer(typeOfSimulation);

    // Show fps, ping, etc
    stats = new Stats();
    container.appendChild( stats.dom );

    window.addEventListener( "resize", onWindowResize );

    initGUI();
    initParticles(typeOfSimulation);
    dynamicValuesChanger();
    const renderScene = new RenderPass( scene, camera );

    /* ---- Adding bloom effect ---- */
    bloomPass = new UnrealBloomPass(
        new THREE.Vector2( window.innerWidth, window.innerHeight ),
        0,
        0,
        0
    );
    bloomPass.strength = bloom.strength;

    composer = new EffectComposer( renderer );
    composer.addPass( renderScene );
    composer.addPass( bloomPass );
    composer.addPass(blendPass);
    composer.addPass(savePass);
    composer.addPass(outputPass);

        baseTimeStep = effectController.timeStep;
}

function initComputeRenderer(typeOfSimulation) {
    let textureSize = Math.round(Math.sqrt(effectController.numberOfStars));
    PARTICLES = textureSize * textureSize; // snap to exact square — no fractional remainder
    gpuCompute = new GPUComputationRenderer( textureSize, textureSize, renderer );
    if ( renderer.capabilities.isWebGL2 === false ) {
        gpuCompute.setDataType( THREE.HalfFloatType );
    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();

    if (typeOfSimulation === "1"){
        fillTextures( dtPosition, dtVelocity );
    } else if (typeOfSimulation === "2"){
        fillUniverseTextures( dtPosition, dtVelocity );
    }  else if (typeOfSimulation === "3"){
        fillGalaxiesCollisionTextures( dtPosition, dtVelocity );
    }

    velocityVariable = gpuCompute.addVariable( "textureVelocity", computeShaderVelocity, dtVelocity );
    positionVariable = gpuCompute.addVariable( "texturePosition", computeShaderPosition, dtPosition );

    gpuCompute.setVariableDependencies( velocityVariable, [ positionVariable, velocityVariable ] );
    gpuCompute.setVariableDependencies( positionVariable, [ positionVariable, velocityVariable ] );

    velocityUniforms = velocityVariable.material.uniforms;
    velocityUniforms[ "gravity" ] = { value: 0.0 };
    velocityUniforms[ "interactionRate" ] = { value: 0.0 };
    velocityUniforms[ "timeStep" ] = { value: 0.0 };
    velocityUniforms[ "uMaxAccelerationColor" ] = { value: 0.0 };
    velocityUniforms[ "blackHoleForce" ] = { value: 0.0 };
    velocityUniforms[ "luminosity" ] = { value: 0.0 };
    // Übergabe der Black-Hole-Parameter als Uniform-Arrays
    // (Im Shader: uniform vec3 uBlackHolePositions[9]; uniform float uBlackHoleMasses[9];)
    const bhPositions = window.blackHoleParams.map(bh => new THREE.Vector3(...bh.position));
    while (bhPositions.length < 30) bhPositions.push(new THREE.Vector3(0, 0, 0));
    const bhMasses = window.blackHoleParams.map(bh => bh.mass);
    while (bhMasses.length < 30) bhMasses.push(0.0);
    velocityUniforms[ "uBlackHolePositions" ] = { value: bhPositions };
    velocityUniforms[ "uBlackHoleMasses" ]    = { value: bhMasses };
    velocityUniforms[ "uNumBlackHoles" ]      = { value: window.blackHoleParams.length };

    const error = gpuCompute.init();

    if ( error !== null ) {
        console.error( error );
    }
}

/**
 * Init particles (material, positions, uvs coordinates)
 * @param typeOfSimulation
 */
function initParticles(typeOfSimulation) {

    // Create a buffer geometry to store the particle data
    geometry = new THREE.BufferGeometry();

    // Create array to store the position of the particles
    const positions = new Float32Array( PARTICLES * 3 );

    // Create an array to store the UV coordinates of each particle
    const uvs = new Float32Array( PARTICLES * 2 );

    // Calculate the size of the matrix based on the (snapped) particle count
    let matrixSize = Math.sqrt(PARTICLES);
    let p = 0;
    for ( let j = 0; j < matrixSize; j ++ ) {
        for ( let i = 0; i < matrixSize; i ++ ) {
            uvs[ p ++ ] = i / ( matrixSize - 1 );
            uvs[ p ++ ] = j / ( matrixSize - 1 );
        }
    }

    geometry.setAttribute( "position", new THREE.BufferAttribute( positions, 3 ) );
    geometry.setAttribute( "uv", new THREE.BufferAttribute( uvs, 2 ) );

    particleUniforms = {
        "texturePosition": { value: null },
        "textureVelocity": { value: null },
        "cameraConstant": { value: getCameraConstant( camera ) },
        "particlesCount": { value: PARTICLES },
        "uMaxAccelerationColor": { value: effectController.maxAccelerationColor },
        "uLuminosity" : { value: luminosity},
        "uHideDarkMatter" : { value: effectController.hideDarkMatter},
    };

    // THREE.ShaderMaterial
    // Create the material of the particles
    material = new THREE.ShaderMaterial( {
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        uniforms: particleUniforms,
        vertexShader:  galaxyVortexShader,
        fragmentShader:  galaxyFragmentShader
    });
    if (typeOfSimulation === "2"){
        material = new THREE.ShaderMaterial( {
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            uniforms: particleUniforms,
            vertexShader:  galaxyVortexShader,
            fragmentShader:  galaxyFragmentShader
        });
    }

    particles = new THREE.Points( geometry, material );
    particles.frustumCulled = false;
    particles.matrixAutoUpdate = false;
    particles.updateMatrix();
    scene.add( particles );
}

/**
 * Init positions et volocities for all particles
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillTextures( texturePosition, textureVelocity ) {

    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const numG    = Math.max(2, Math.min(30, Math.round(effectController.numberOfGalaxies || 30)));
    const R       = effectController.radius;
    const H       = effectController.height;
    const mV      = effectController.middleVelocity;
    const maxVel  = effectController.velocity;
    const bhMass  = effectController.blackHoleForce;
    const G_init  = effectController.gravity;

    // Cluster reference radius and virial velocity
    const Rcl  = R * 20.0;
    const vVir = Math.sqrt(Math.max(0, G_init * bhMass * numG / Math.max(Rcl, 1)));

    window.blackHoleParams = [];
    blackHoleVelocities    = [];
    const defs = [];

    // ── Structured unit system: solos · pairs · triplets ─────────────────────
    // Each restart: 30 galaxies are randomly partitioned into units of size 1, 2, or 3.
    // Each unit occupies a unique position in 3D space and has its own trajectory
    // archetype. Three distance tiers (inner/mid/outer) guarantee staggered arrival
    // times — inner units collide first, outer units arrive long after.

    // Step 1 — build unit size list (weights: 20% solo, 42% pair, 38% triplet)
    const unitSizes = [];
    let _assigned = 0;
    while (_assigned < numG) {
        const left = numG - _assigned;
        let sz;
        if      (left === 1) sz = 1;
        else if (left === 2) sz = 2;
        else { const r = Math.random(); sz = r < 0.20 ? 1 : r < 0.62 ? 2 : 3; }
        unitSizes.push(sz);
        _assigned += sz;
    }
    const nUnits = unitSizes.length;

    // Step 2 — shuffle galaxy indices, then assign to units in order
    const _shuffled = Array.from({length: numG}, (_, i) => i);
    for (let i = numG - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = _shuffled[i]; _shuffled[i] = _shuffled[j]; _shuffled[j] = t;
    }
    const _unitOf     = new Int32Array(numG); // unit index per galaxy
    const _posInUnit  = new Int32Array(numG); // seat index within unit (0/1/2)
    let _gi = 0;
    for (let u = 0; u < nUnits; u++) {
        for (let s = 0; s < unitSizes[u]; s++) {
            _unitOf[_shuffled[_gi]] = u;
            _posInUnit[_shuffled[_gi]] = s;
            _gi++;
        }
    }

    // Step 3 — place each unit on Fibonacci sphere, distance tier = u % 3
    //   tier 0 (inner)  0.6–1.0 × Rcl  → arrives first
    //   tier 1 (mid)    1.2–1.7 × Rcl  → arrives second
    //   tier 2 (outer)  2.0–2.6 × Rcl  → arrives last
    const PHI = Math.PI * (1.0 + Math.sqrt(5));
    const unitCfg = [];
    for (let u = 0; u < nUnits; u++) {
        const theta = Math.acos(1 - 2 * (u + 0.5) / nUnits);
        const phi   = PHI * u;
        const nx = Math.sin(theta) * Math.cos(phi);
        const ny = Math.cos(theta);
        const nz = Math.sin(theta) * Math.sin(phi);

        const tier = u % 3;
        const distFrac = tier === 0 ? 0.6 + Math.random() * 0.4
                       : tier === 1 ? 1.2 + Math.random() * 0.5
                       :              2.0 + Math.random() * 0.6;
        const dist = Rcl * distFrac;
        const ux = nx * dist, uy = ny * dist, uz = nz * dist;

        const inwardDir  = new THREE.Vector3(-nx, -ny, -nz);
        const upRef      = Math.abs(ny) < 0.85 ? new THREE.Vector3(0,1,0)
                                                : new THREE.Vector3(1,0,0);
        const tangentDir = new THREE.Vector3().crossVectors(inwardDir, upRef).normalize();
        // Second tangent axis (for triplet triangle plane)
        const tangent2   = new THREE.Vector3().crossVectors(tangentDir, inwardDir).normalize();

        // Step 4 — trajectory archetype for this unit
        //   0 direct collision · 1 cross-cluster · 2 close flyby
        //   3 distant sweep    · 4 slow spiral
        const archetype = Math.floor(Math.random() * 5);
        let tX = 0, tY = 0, tZ = 0, speedMult, tangFrac;
        if (archetype === 0) {
            speedMult = 1.0 + Math.random() * 0.8;  tangFrac = Math.random() * 0.08;
        } else if (archetype === 1) {
            const f = 0.8 + Math.random() * 0.4;
            tX = -ux*f; tY = -uy*f; tZ = -uz*f;
            speedMult = 1.0 + Math.random() * 0.8;  tangFrac = 0.05 + Math.random() * 0.15;
        } else if (archetype === 2) {
            const b = R * (2 + Math.random() * 4);
            tX = tangentDir.x*b; tY = tangentDir.y*b; tZ = tangentDir.z*b;
            speedMult = 0.7 + Math.random() * 0.6;  tangFrac = 0.20 + Math.random() * 0.30;
        } else if (archetype === 3) {
            const b = R * (6 + Math.random() * 6);
            tX = tangentDir.x*b; tY = tangentDir.y*b; tZ = tangentDir.z*b;
            speedMult = 0.5 + Math.random() * 0.5;  tangFrac = 0.45 + Math.random() * 0.40;
        } else {
            speedMult = 0.2 + Math.random() * 0.3;  tangFrac = 0.70 + Math.random() * 0.30;
        }
        const toTarget  = new THREE.Vector3(tX-ux, tY-uy, tZ-uz).normalize();
        const baseSpeed = vVir * speedMult;
        const bulkVec   = toTarget.multiplyScalar(baseSpeed * (1 - tangFrac))
                            .add(tangentDir.clone().multiplyScalar(baseSpeed * tangFrac));

        // Per-unit random separation: 10–50 × R (4–20× the old 2.5R default)
        const unitSepR = R * (10 + Math.random() * 40);
        unitCfg.push({ ux, uy, uz, bulkVec, tangentDir: tangentDir.clone(),
                       tangent2: tangent2.clone(), sz: unitSizes[u], sepR: unitSepR });
    }

    // Step 5 — per-galaxy offset inside unit + final position/velocity
    const galaxyDef = new Array(numG);

    for (let g = 0; g < numG; g++) {
        const u   = _unitOf[g];
        const s   = _posInUnit[g];
        const cfg = unitCfg[u];
        const sz  = cfg.sz;
        const sepR = cfg.sepR; // per-unit random separation (10–50 × R)

        let lx = 0, ly = 0, lz = 0, lvx = 0, lvy = 0, lvz = 0;

        if (sz === 2) {
            // Two galaxies on opposite sides of unit centre; approach each other
            const sign = s === 0 ? 1 : -1;
            lx = cfg.tangentDir.x * sepR * sign;
            ly = cfg.tangentDir.y * sepR * sign;
            lz = cfg.tangentDir.z * sepR * sign;
            // Each moves inward at 30% virial speed → head-on inside the pair
            const vRel = vVir * 0.30;
            lvx = -cfg.tangentDir.x * sign * vRel;
            lvy = -cfg.tangentDir.y * sign * vRel;
            lvz = -cfg.tangentDir.z * sign * vRel;
        } else if (sz === 3) {
            // Equilateral triangle; slight random phase jitter per restart
            const angle = (2 * Math.PI * s) / 3 + Math.random() * 0.25;
            lx = (cfg.tangentDir.x * Math.cos(angle) + cfg.tangent2.x * Math.sin(angle)) * sepR;
            ly = (cfg.tangentDir.y * Math.cos(angle) + cfg.tangent2.y * Math.sin(angle)) * sepR;
            lz = (cfg.tangentDir.z * Math.cos(angle) + cfg.tangent2.z * Math.sin(angle)) * sepR;
            // Slow infall toward triplet centre (12% virial) — merges gradually
            const vRel = vVir * 0.12;
            lvx = -lx / sepR * vRel;
            lvy = -ly / sepR * vRel;
            lvz = -lz / sepR * vRel;
        }
        // Solo: all offsets zero

        const cx = cfg.ux + lx;
        const cy = cfg.uy + ly;
        const cz = cfg.uz + lz;
        const rot = new THREE.Euler(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 0.5, 'XYZ');
        const sizeFactor  = 0.5 + Math.random() * 1.0;
        const thickFactor = 0.3 + Math.random() * 1.4;
        const velFactor   = 0.8 + Math.random() * 0.4;

        galaxyDef[g] = {
            cx, cy, cz,
            vx: cfg.bulkVec.x + lvx,
            vy: cfg.bulkVec.y + lvy,
            vz: cfg.bulkVec.z + lvz,
            rot,
            r: R * sizeFactor, h: H * thickFactor, v: maxVel * velFactor
        };
    }

    // Build BH arrays in galaxy-index order (GLSL requires blackHoleParams[g] ↔ galaxy g)
    for (let g = 0; g < numG; g++) {
        const d = galaxyDef[g];
        defs.push(d);
        window.blackHoleParams.push({ position: [d.cx, d.cy, d.cz], mass: bhMass });
        blackHoleVelocities.push([d.vx, d.vy, d.vz]);
    }

    // Interleaved layout: texture slot idx = g + i*numG
    // → the interaction scan zone (top-left rect) contains particles from every galaxy equally
    // → particle–particle gravity operates identically for all 30 galaxies
    const perGalaxy = new Int32Array(numG); // per-galaxy particle counter
    for (let idx = 0; idx < PARTICLES; idx++) {
        const g   = idx % numG;
        const i   = perGalaxy[g]++;
        const k   = idx * 4;
        const def = defs[g];

        if (i === 0) {
            // Black hole: at galaxy centre, carries bulk cluster velocity
            posArray[k]   = def.cx; posArray[k+1] = def.cy;
            posArray[k+2] = def.cz; posArray[k+3] = g;
            velArray[k]   = def.vx; velArray[k+1] = def.vy;
            velArray[k+2] = def.vz; velArray[k+3] = 0;
            continue;
        }

        // Exponential disk placement (rejection-sampled unit disk)
        let x, z, rr;
        do {
            x  = Math.random() * 2 - 1;
            z  = Math.random() * 2 - 1;
            rr = x*x + z*z;
        } while (rr > 1);
        rr = Math.sqrt(rr);

        const rExp  = def.r * Math.pow(rr, mV);
        const circV = def.v * Math.pow(rr, 0.2);

        let pvx =  circV * z  + (Math.random() - 0.5) * 0.002;
        let pvy = (Math.random() - 0.5) * 0.002;
        let pvz = -circV * x  + (Math.random() - 0.5) * 0.002;

        const lp = new THREE.Vector3(x * rExp, (Math.random() * 2 - 1) * def.h, z * rExp).applyEuler(def.rot);
        const lv = new THREE.Vector3(pvx, pvy, pvz).applyEuler(def.rot);

        posArray[k]   = lp.x + def.cx; posArray[k+1] = lp.y + def.cy;
        posArray[k+2] = lp.z + def.cz; posArray[k+3] = g;
        velArray[k]   = lv.x + def.vx; velArray[k+1] = lv.y + def.vy;
        velArray[k+2] = lv.z + def.vz; velArray[k+3] = 0;
    }

    baseTimeStep = effectController.timeStep;
}

/**
 * Init positions et volocities for all particles
 * @param texturePosition array that contain positions of particles
 * @param textureVelocity array that contain velocities of particles
 */
function fillUniverseTextures( texturePosition, textureVelocity ) {
    window.blackHoleParams = [];
    blackHoleVelocities    = [];

    const posArray = texturePosition.image.data;
                        // entfernt: baseInteractionRate = effectController.interactionRate;
                        baseTimeStep = effectController.timeStep;
    const velArray = textureVelocity.image.data;

    // Set the radius of the sphere
    const radius = effectController.radius;

    // Set the pulse strength
    let pulseScale = 5;
    if (selectedChoice === 1){
        pulseScale = 3.18;
    }

    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        // Generate random point within a unit sphere
        let x, y, z;
        do {
            x = ( Math.random() * 2 - 1 );
            y = ( Math.random() * 2 - 1 );
            z = ( Math.random() * 2 - 1 );
        } while ( x*x + y*y + z*z > 1 );

        // Scale point to desired radius
        x *= radius;
        y *= radius;
        z *= radius;

        // Velocity
        const vx = pulseScale * x;
        const vy = pulseScale * y;
        const vz = pulseScale * z;

        // Fill in texture values
        posArray[ k + 0 ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;
        // Hide dark matter (hide 85% of stars)
                        // entfernt: baseInteractionRate = effectController.interactionRate;
                        baseTimeStep = effectController.timeStep;
        if (k > 0.85 * (posArray.length / 4)){
            posArray[ k + 3 ] = 1;
        } else {
            posArray[ k + 3 ] = 0;
        }

        velArray[ k + 0 ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = 0;
    }
}

function fillGalaxiesCollisionTextures( texturePosition, textureVelocity ){
    window.blackHoleParams = [];
    blackHoleVelocities    = [];

    const posArray = texturePosition.image.data;
    const velArray = textureVelocity.image.data;

    const radius = effectController.radius;
    const height = effectController.height;
    const middleVelocity = effectController.middleVelocity;
    const maxVel = effectController.velocity;
    let indice = 0;
    for ( let k = 0, kl = posArray.length; k < kl; k += 4 ) {
        // Position
        let x, z, rr, y, vx, vy, vz;
        // If pair
        if (indice % 2 === 0){
            // Generate random position for the particle within the radius
            do {
                x = ( Math.random() * 2 - 1 );
                z = ( Math.random() * 2 - 1 );
                // The variable rr is used to calculate the distance from the center of the radius for each particle.
                // It is used in the calculation of rExp which is used to determine the position of the particle within the radius.
                // If a particle is closer to the center, rr will be smaller, and rExp will be larger, which means that the particle will be placed closer to the center.
                // It also can affect the velocity of the particle as it is used in the calculation of the velocity of the particle.
                rr = x * x + z * z;

            } while ( rr > 1 );
            rr = Math.sqrt( rr );

                        // entfernt: baseInteractionRate = effectController.interactionRate;
                        baseTimeStep = effectController.timeStep;
            const rExp = radius * Math.pow( rr, middleVelocity );

            // Velocity
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = vel * z + ( Math.random() * 2 - 1 ) * 0.001;
            vy = ( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            vz = - vel * x + ( Math.random() * 2 - 1 ) * 0.001;

            x *= rExp;
            z *= rExp;
            y = ( Math.random() * 2 - 1 ) * height;
        }
        // If impair
        else {
            // Generate random position for the particle within the radius
            do {
                x = ( Math.random() * 2 - 1 );
                y = ( Math.random() * 2 - 1 );
                // The variable rr is used to calculate the distance from the center of the radius for each particle.
                // It is used in the calculation of rExp which is used to determine the position of the particle within the radius.
                // If a particle is closer to the center, rr will be smaller, and rExp will be larger, which means that the particle will be placed closer to the center.
                // It also can affect the velocity of the particle as it is used in the calculation of the velocity of the particle.
                rr = x*x + y*y;

            } while ( rr > 1 );
            rr = Math.sqrt( rr );

            const rExp = radius * Math.pow( rr, middleVelocity );

            // Velocity
            const vel = maxVel * Math.pow( rr, 0.2 );

            vx = -vel * y + ( Math.random() * 2 - 1 ) * 0.001;
                        // entfernt: baseInteractionRate = effectController.interactionRate;
                        baseTimeStep = effectController.timeStep;
            vy =  vel * x + ( Math.random() * 2 - 1 ) * 0.001;
            vz = -( Math.random() * 2 - 1 ) * 0.001 * 0.05;
            const angle = -Math.PI/4;

            const vy_temp = vy;
            const vz_temp = vz;
            vy = vy_temp * Math.cos(angle) - vz_temp * Math.sin(angle);
            vz = vy_temp * Math.sin(angle) + vz_temp * Math.cos(angle);

            x = x*rExp +200;
            y = y*rExp +200;
            z = ( Math.random() * 2 - 1 ) * height +10;
            const y_temp = y;
            const z_temp = z;
            y = y_temp * Math.cos(angle) - z_temp * Math.sin(angle);
            z = y_temp * Math.sin(angle) + z_temp * Math.cos(angle);
        }


        // Fill in texture values
        posArray[ k + 0 ] = x;
        posArray[ k + 1 ] = y;
        posArray[ k + 2 ] = z;
        // Hide dark matter (hide 85% of stars)
        if (k > 0.85 * (posArray.length / 4)){
            posArray[ k + 3 ] = 1;
        } else {
            posArray[ k + 3 ] = 0;
        }

        velArray[ k + 0 ] = vx;
        velArray[ k + 1 ] = vy;
        velArray[ k + 2 ] = vz;
        velArray[ k + 3 ] = 0;
                        // entfernt: baseInteractionRate = effectController.interactionRate;
                        baseTimeStep = effectController.timeStep;
        indice++;
    }
}

/**
 * Restart the simulation
 */
function restartSimulation() {
    paused = false;
    scene.remove(particles);
    material.dispose();
    geometry.dispose();
    document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

    document.body.removeChild(document.querySelector("canvas").parentNode);

    PARTICLES = effectController.numberOfStars;

    init(effectController.typeOfSimulation.toString());
}

function resetParameters(){
    switchSimulation();
}

/**
 * manage the resize of the windows to keep the scene centered
 */
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    particleUniforms[ "cameraConstant" ].value = getCameraConstant( camera );
}

function dynamicValuesChanger() {
    velocityUniforms[ "gravity" ].value = effectController.gravity;
    velocityUniforms[ "interactionRate" ].value = effectController.interactionRate;
    velocityUniforms[ "timeStep" ].value = effectController.timeStep;
    console.log(effectController.maxAccelerationColor);
    velocityUniforms[ "uMaxAccelerationColor" ].value = effectController.maxAccelerationColor;
    velocityUniforms[ "blackHoleForce" ].value = effectController.blackHoleForce;
    velocityUniforms[ "luminosity" ].value = effectController.luminosity;
}

/**
 * Init the menu
 */
function initGUI() {

    const gui = new GUI( { width: 350 } );

    const folder1 = gui.addFolder( "Dynamic Parameters" );

    const folderGraphicSettings = gui.addFolder( "Graphics settings" );

    const folder2 = gui.addFolder( "Static parameters (need to restart the simulation)" );

    folder1.add( effectController, "gravity", 0.0, 1000.0, 0.05 ).onChange( dynamicValuesChanger ).name("Gravitational force");
    folder1.add( effectController, "interactionRate", 0.0, 1.0, 0.001 ).onChange( dynamicValuesChanger ).name("Interaction rate (%)");
    folder1.add( effectController, "timeStep", 0.0, 0.01, 0.0001 ).onChange( dynamicValuesChanger ).name("Time step");
    folder1.add( effectController, "hideDarkMatter", 0, 1, 1 ).onChange( function ( value ) {
        effectController.hideDarkMatter =  value ;
    }   ).name("Hide dark matter");
    folderGraphicSettings.add( bloom, "strength", 0.0, 2.0, 0.1 ).onChange(  function ( value ) {
        bloom.strength =  value ;
        bloomPass.strength = bloom.strength;
    }  ).name("Bloom");
    folderGraphicSettings.add( effectController, "motionBlur", 0, 1, 1 ).onChange( function ( value ) {
        effectController.motionBlur =  value ;
    }   ).name("Motion blur");
    if (effectController.typeOfSimulation === 1 || effectController.typeOfSimulation === 3){
        folder1.add( effectController, "blackHoleForce", 0.0, 10000.0, 1.0 ).onChange( dynamicValuesChanger ).name("Black hole mass");
        folderGraphicSettings.add( effectController, "maxAccelerationColorPercent", 0.01, 100, 0.01 ).onChange(  function ( value ) {
            effectController.maxAccelerationColor = value * 10;
            dynamicValuesChanger();
        }  ).name("Colors mix (%)");
        folder2.add( effectController, "numberOfStars", 2.0, 1000000.0, 1.0 ).name("Number of stars");
        folder2.add( effectController, "radius", 1.0, 1000.0, 1.0 ).name("Galaxy diameter");
        folder2.add( effectController, "height", 0.0, 50.0, 0.01 ).name("Galaxy height");
        folder2.add( effectController, "middleVelocity", 0.0, 20.0, 0.001 ).name("Center rotation speed");
        folder2.add( effectController, "velocity", 0.0, 150.0, 0.1 ).name("Initial rotation speed");
        if (effectController.typeOfSimulation === 1) {
            folder2.add( effectController, "numberOfGalaxies", 2, 30, 1 ).name("Number of galaxies");
        }
    } else if (effectController.typeOfSimulation === 2){
        folderGraphicSettings.add( effectController, "luminosity", 0.0, 1.0, 0.0001 ).onChange( dynamicValuesChanger ).name("Luminosity");
        folderGraphicSettings.add( effectController, "maxAccelerationColorPercent", 0.01, 100, 0.01 ).onChange(  function ( value ) {
            effectController.maxAccelerationColor = value / 10;
            dynamicValuesChanger();
        }  ).name("Colors mix (%)");
        folder2.add( effectController, "numberOfStars", 2.0, 10000000.0, 1.0 ).name("Number of galaxies");
        folder2.add( effectController, "radius", 1.0, 1000.0, 1.0 ).name("Initial diameter of the universe");
        folder2.add( effectController, "autoRotation").name("Auto-rotation").listen().onChange(function(){setChecked();});
    }


    const buttonRestart = {
        restartSimulation: function () {
            restartSimulation();
        }
    };

    const buttonReset = {
        resetParameters: function () {
            resetParameters();
        }
    };
    const buttonPause = {
        pauseSimulation: function () {
        }
    };


    function setChecked(){
        autoRotation = !autoRotation;
        controls.autoRotate = autoRotation;
    }

    folder2.add( effectController, "typeOfSimulation", typeOfSimulation ).onChange(switchSimulation).name("Type of simulation");
    folder2.add( buttonRestart, "restartSimulation" ).name("Restart the simulation");
    folder2.add( buttonReset, "resetParameters" ).name("Reset parameters");
    let buttonPauseController = folder2.add( buttonPause, "pauseSimulation" ).name("Pause");
    buttonPauseController.onChange(function(){
        paused = !paused;
        if(paused){
            buttonPauseController.name("Resume");
        }else{
            buttonPauseController.name("Pause");
        }
        buttonPauseController.updateDisplay();
    });

    folder1.open();
    folder2.open();
    folderGraphicSettings.open();
}

function getCameraConstant( camera ) {
    return window.innerHeight / ( Math.tan( THREE.MathUtils.DEG2RAD * 0.5 * camera.fov ) / camera.zoom );
}

/**
 * Switch the current simulation
 */
function switchSimulation(){
    paused = false;
    // Normal mode (small configuration)
    if (selectedChoice === 1){
        switch (effectController.typeOfSimulation.toString()) {
            // Single galaxy
            case "1":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: 126.15,
                    interactionRate: 0.019,
                    timeStep: 0.01,
                    blackHoleForce: 1568.0,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 4.0,
                    maxAccelerationColorPercent: 0.4,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 241064,
                    radius: 357,
                    height: 5,
                    middleVelocity: 2,
                    velocity: 14.3,
                    numberOfGalaxies: 30,
                    typeOfSimulation: 1,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

                document.body.removeChild(document.querySelector("canvas").parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Universe
            case "2":
                scene.remove(particles);
                bloom.strength = 0.7;
                effectController = {
                    // Can be changed dynamically
                    gravity: 225.0,
                    interactionRate: 0.05,
                    timeStep: 0.0001,
                    blackHoleForce: 100.0,
                    luminosity: 0.25,
                    maxAccelerationColor: 2.0,
                    maxAccelerationColorPercent: 20,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 100000,
                    radius: 2,
                    height: 5,
                    middleVelocity: 2,
                    velocity: 15,
                    typeOfSimulation: 2,
                    autoRotation: true
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

                document.body.removeChild(document.querySelector("canvas").parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Galaxies collision
            case "3":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: 40,
                    interactionRate: 0.5,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 15.0,
                    maxAccelerationColorPercent: 1.5,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 10000,
                    radius: 50,
                    height: height,
                    middleVelocity: middleVelocity,
                    velocity: 7,
                    typeOfSimulation: 3,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

                document.body.removeChild(document.querySelector("canvas").parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            default:
                break;
        }
    } else {
        switch (effectController.typeOfSimulation.toString()) {
            // Single galaxy
            case "1":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: gravity,
                    interactionRate: interactionRate,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 4.0,
                    maxAccelerationColorPercent: 0.4,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 241064,
                    radius: 357,
                    height: 5,
                    middleVelocity: 2,
                    velocity: 14.3,
                    numberOfGalaxies: 30,
                    typeOfSimulation: 1,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

                document.body.removeChild(document.querySelector("canvas").parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Universe
            case "2":
                scene.remove(particles);
                bloom.strength = 0.7;
                effectController = {
                    // Can be changed dynamically
                    gravity: 20.0,
                    interactionRate: 0.05,
                    timeStep: 0.0001,
                    blackHoleForce: 100.0,
                    luminosity: 0.25,
                    maxAccelerationColor: 2.0,
                    maxAccelerationColorPercent: 20,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: 1000000,
                    radius: 2,
                    height: 5,
                    middleVelocity: 2,
                    velocity: 15,
                    typeOfSimulation: 2,
                    autoRotation: true
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

                document.body.removeChild(document.querySelector("canvas").parentNode);

                PARTICLES = effectController.numberOfStars;

                init(effectController.typeOfSimulation.toString());
                break;
            // Galaxies collision
            case "3":
                scene.remove(particles);
                bloom.strength = 1.0;
                effectController = {
                    // Can be changed dynamically
                    gravity: gravity,
                    interactionRate: interactionRate,
                    timeStep: timeStep,
                    blackHoleForce: blackHoleForce,
                    luminosity: constLuminosity,
                    maxAccelerationColor: 19.0,
                    maxAccelerationColorPercent: 1.9,
                    motionBlur: false,
                    hideDarkMatter: false,

                    // Must restart simulation
                    numberOfStars: numberOfStars,
                    radius: radius,
                    height: height,
                    middleVelocity: middleVelocity,
                    velocity: 12,
                    typeOfSimulation: 3,
                    autoRotation: false
                };
                material.dispose();
                geometry.dispose();
                document.getElementsByClassName("dg ac").item(0).removeChild(document.getElementsByClassName("dg main a").item(0));

                document.body.removeChild(document.querySelector("canvas").parentNode);

                PARTICLES = effectController.numberOfStars;
                init(effectController.typeOfSimulation.toString());

                break;
            default:
                break;
        }
    }

}

function animate() {
    controls.update();
    requestAnimationFrame(animate);
    render();
    stats.update();
}

// Eventlistener für Simulationsgeschwindigkeit (T) und Time Step (Z)
document.addEventListener("keydown", function(e) {
    // T für Simulationsgeschwindigkeit (nur Render-Loop, nicht Physik-Zeitschritt!)
    if (e.key === "t" || e.key === "T") {
        simulationSpeedIndex = (simulationSpeedIndex + 1) % simulationSpeedMultipliers.length;
        simulationSpeedMultiplier = simulationSpeedMultipliers[simulationSpeedIndex];
        showOverlay("Speed x" + simulationSpeedMultiplier);
    }
    // Z für Time Step
    if (e.key === "z" || e.key === "Z") {
        timeStepIndex = (timeStepIndex + 1) % timeStepMultipliers.length;
        let factor = timeStepMultipliers[timeStepIndex];
        effectController.timeStep = baseTimeStep * factor;
        dynamicValuesChanger();
        showOverlay("Time Step x" + factor);
    }
});

function render() {
    if (!paused){
        // Black Hole Bewegungen und Gravitation
        for (let step = 0; step < simulationSpeedMultiplier; step++) {
            // BH-BH gravity — G matches the velocity shader uniform for scale consistency
            const G_bh  = effectController.gravity;
            const soft2 = effectController.radius * effectController.radius * 0.01 + 1.0;
            for (let i = 0; i < window.blackHoleParams.length; i++) {
                const posA  = window.blackHoleParams[i].position;
                const velA  = blackHoleVelocities[i];
                const massA = window.blackHoleParams[i].mass;
                let fx = 0, fy = 0, fz = 0;
                for (let j = 0; j < window.blackHoleParams.length; j++) {
                    if (i === j) continue;
                    const posB  = window.blackHoleParams[j].position;
                    const massB = window.blackHoleParams[j].mass;
                    const dx = posB[0] - posA[0];
                    const dy = posB[1] - posA[1];
                    const dz = posB[2] - posA[2];
                    const distSq = dx*dx + dy*dy + dz*dz + soft2;
                    const dist   = Math.sqrt(distSq);
                    // Acceleration on A due to B (same form as shader: G * bhMass / distSq)
                    const a = G_bh * massB / distSq;
                    fx += a * dx / dist;
                    fy += a * dy / dist;
                    fz += a * dz / dist;
                }
                velA[0] += fx * effectController.timeStep;
                velA[1] += fy * effectController.timeStep;
                velA[2] += fz * effectController.timeStep;
            }
            // Position update uses delta = 1/30 to match the GPU position shader exactly
            const bhDelta = 1.0 / 30.0;
            for (let i = 0; i < window.blackHoleParams.length; i++) {
                const pos = window.blackHoleParams[i].position;
                const vel = blackHoleVelocities[i];
                pos[0] += vel[0] * bhDelta;
                pos[1] += vel[1] * bhDelta;
                pos[2] += vel[2] * bhDelta;
            }
            // Push updated BH positions to velocity shader
            if (velocityUniforms && velocityUniforms["uBlackHolePositions"]) {
                const updatedPos = window.blackHoleParams.map(bh => new THREE.Vector3(...bh.position));
                while (updatedPos.length < 30) updatedPos.push(new THREE.Vector3(0, 0, 0));
                const updatedMasses = window.blackHoleParams.map(bh => bh.mass);
                while (updatedMasses.length < 30) updatedMasses.push(0.0);
                velocityUniforms["uBlackHolePositions"].value = updatedPos;
                velocityUniforms["uBlackHoleMasses"].value    = updatedMasses;
                if (velocityUniforms["uNumBlackHoles"]) {
                    velocityUniforms["uNumBlackHoles"].value = window.blackHoleParams.length;
                }
            }
            // Particle simulation step
            gpuCompute.compute();
        }
        particleUniforms[ "texturePosition" ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
        particleUniforms[ "textureVelocity" ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
        material.uniforms.uMaxAccelerationColor.value = effectController.maxAccelerationColor;
    }
    if (effectController.motionBlur){
        composer.removePass(blendPass);
        composer.removePass(savePass);
        composer.removePass(outputPass);
        composer.addPass(blendPass);
        composer.addPass(savePass);
        composer.addPass(outputPass);
    } else {
        composer.removePass(blendPass);
        composer.removePass(savePass);
        composer.removePass(outputPass);
    }
    material.uniforms.uLuminosity.value = effectController.luminosity;
    material.uniforms.uHideDarkMatter.value = effectController.hideDarkMatter;
    composer.render(scene, camera);
}