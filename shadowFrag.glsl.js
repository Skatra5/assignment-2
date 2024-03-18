export default `#version 300 es
precision highp float;

uniform sampler2D uSampler;

in vec4 vColor;
in vec4 vLightSpacePos;
out vec4 outColor;

float shadowCalculation(vec4 lightSpacePos) {
    // Transform to [0,1] range
    vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
    projCoords = projCoords * 0.5 + 0.5;
    
    // Get closest depth value from light's perspective
    float closestDepth = texture(uSampler, projCoords.xy).r; 
    // Check if current fragment is in shadow
    float currentDepth = projCoords.z;
    float shadow = currentDepth > closestDepth  ? 1.0 : 0.0;
    return shadow;
}

void main() {
    float shadow = shadowCalculation(vLightSpacePos);
    outColor = vec4(vec3(shadow), 1.0); // This is simplified; you would normally blend this with the object's texture/color
}
`;