export default `#version 300 es

uniform mat4 uModel;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uLightView;
uniform mat4 uLightProjection;
uniform vec4 uColor;
uniform vec3 uLightDir;
uniform bool uHasNormals;

in vec3 position;
in vec3 normal;

out vec4 vColor;
out vec4 vLightSpacePos;

void main() {
    gl_Position = uProjection * uView * uModel * vec4(position, 1.0);
    // Compute the position of the vertex in light space
    vLightSpacePos = uLightProjection * uLightView * uModel * vec4(position, 1.0);
    if (uHasNormals) {
        // Apply lighting effect here if needed. This is a simplified placeholder.
        vColor = vec4(normalize(normal) * 0.5 + 0.5, 1.0);
    } else {
        vColor = uColor;
    }
}

`;