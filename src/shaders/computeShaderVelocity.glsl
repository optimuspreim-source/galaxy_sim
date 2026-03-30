// #include <common>

uniform float timeStep;
uniform float gravity;
uniform float interactionRate;
uniform float blackHoleForce;
uniform float uMaxAccelerationColor;
uniform int uNumBlackHoles;
uniform vec3 uBlackHolePositions[9];
uniform float uBlackHoleMasses[9];

const float width = resolution.x;
const float height = resolution.y;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    float idParticle = uv.y * resolution.x + uv.x;

    // Sample the position and velocity of the current particle from the input textures
    vec4 tmpPos = texture2D( texturePosition, uv );
    vec3 pos = tmpPos.xyz;
    float galaxyIndex = tmpPos.w;

    vec4 tmpVel = texture2D( textureVelocity, uv );
    vec3 vel = tmpVel.xyz;
    float accColor = tmpVel.w;

    vec3 acceleration = vec3( 0.0 );

    // --- Intergalaktische Kräfte: Black Holes aller Galaxien ---
    for (int g = 0; g < uNumBlackHoles; g++) {
        vec3 bhPos = uBlackHolePositions[g];
        float bhMass = uBlackHoleMasses[g];
        vec3 dPos = bhPos - pos;
        float distance = length(dPos) + 1e-3;
        float distanceSq = distance * distance + 1.0;
        float grav = gravity * bhMass / distanceSq;
        grav = min(grav, 1.0);
        // Eigene Galaxie: stärkere Gravitation
        if (int(galaxyIndex + 0.5) == g) {
            grav *= 2.0;
        }
        acceleration += grav * normalize(dPos);
    }

    // --- Optionale: Partikel-Partikel-Kräfte innerhalb der eigenen Galaxie ---
    for ( float y = 0.0; y < height * interactionRate; y++ ) {
        for ( float x = 0.0; x < width * interactionRate; x++ ) {
            vec2 secondParticleCoords = vec2( x + 0.5, y  + 0.5) / resolution.xy;
            vec4 pos2raw = texture2D( texturePosition, secondParticleCoords );
            vec3 pos2 = pos2raw.xyz;
            float galaxyIndex2 = pos2raw.w;
            float idParticle2 = secondParticleCoords.y * resolution.x + secondParticleCoords.x;
            if ( idParticle == idParticle2 ) {
                continue;
            }
            // Nur Partikel aus derselben Galaxie
            if (int(galaxyIndex2 + 0.5) != int(galaxyIndex + 0.5)) {
                continue;
            }
            vec3 dPos = pos2 - pos;
            float distance = length( dPos );
            float distanceSq = (distance * distance) + 1.0;
            float gravityField = gravity * 1.0 / distanceSq;
            gravityField = min( gravityField, 1.0 );
            acceleration += gravityField * normalize( dPos );
        }
    }

    vel += timeStep * acceleration;
    accColor = length(acceleration);
    if (length(accColor) > uMaxAccelerationColor) {
      accColor = normalize(accColor) * uMaxAccelerationColor;
    }
    gl_FragColor = vec4( vel, accColor );
}
