import layerVertShaderSrc from './layerVert.glsl.js';
import layerFragShaderSrc from './layerFrag.glsl.js';
import shadowFragShaderSrc from './shadowFrag.glsl.js';
import shadowVertShaderSrc from './shadowVert.glsl.js';
import depthFragShaderSrc from './depthFrag.glsl.js';
import depthVertShaderSrc from './depthVert.glsl.js';

var gl;

var layers = null
var renderToScreen = null;
var fbo = null;
var currRotate = 0;
var currLightRotate = 0;
var currLightDirection = null;
var currZoom = 0;
var currProj = 'perspective';
var currResolution = 2048;
var displayShadowmap = false;

function multiplyVecByScalar(vec, scalar) {
    return [vec[0] * scalar, vec[1] * scalar, vec[2] * scalar];
}

/*
    FBO
*/
class FBO {
    constructor(size) {
        this.size = size;
        this.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        this.texture = createTexture2D(gl, size, size, gl.RGBA, 0, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
        this.rbo = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbo);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rbo);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE) {
            console.error("Framebuffer not complete");
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }
    
    start() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.size, this.size);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    
    stop() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    
}

/*
    Shadow map
*/
class ShadowMapProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, shadowVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, shadowFragShaderSrc);
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);

        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.colorAttribLoc = gl.getUniformLocation(this.program, "uColor");
        this.modelLoc = gl.getUniformLocation(this.program, "uModel");
        this.projectionLoc = gl.getUniformLocation(this.program, "uProjection");
        this.viewLoc = gl.getUniformLocation(this.program, "uView");
        this.lightViewLoc = gl.getUniformLocation(this.program, "uLightView");
        this.lightProjectionLoc = gl.getUniformLocation(this.program, "uLightProjection");
        this.samplerLoc = gl.getUniformLocation(this.program, "uSampler");
        this.hasNormalsAttribLoc = gl.getUniformLocation(this.program, "uHasNormals");
        this.lightDirAttribLoc = gl.getUniformLocation(this.program, "uLightDir");    
    }

    use() {
        gl.useProgram(this.program);
    }    
}

/*
    Render to screen program
*/
class RenderToScreenProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, depthVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, depthFragShaderSrc);
        
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);
        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.samplerLoc = gl.getUniformLocation(this.program, "uSampler");
        this.quadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);
        gl.enableVertexAttribArray(this.posAttribLoc);
        gl.vertexAttribPointer(this.posAttribLoc, 2, gl.FLOAT, false, 0, 0);

       
        
    }

    draw(texture) {
        gl.useProgram(this.program);
        gl.bindVertexArray(this.quadVAO);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(this.samplerLoc, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

}

/*
    Layer program
*/
class LayerProgram {
    constructor() {
        this.vertexShader = createShader(gl, gl.VERTEX_SHADER, layerVertShaderSrc);
        this.fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, layerFragShaderSrc);
        this.program = createProgram(gl, this.vertexShader, this.fragmentShader);

        this.posAttribLoc = gl.getAttribLocation(this.program, "position");
        this.colorAttribLoc = gl.getUniformLocation(this.program, "uColor");
        this.modelLoc = gl.getUniformLocation(this.program, "uModel");
        this.projectionLoc = gl.getUniformLocation(this.program, "uProjection");
        this.viewLoc = gl.getUniformLocation(this.program, "uView");
    }

    use() {
        gl.useProgram(this.program);
    }
}


/*
    Collection of layers
*/
class Layers {
    constructor() {
        this.layers = {};
        this.centroid = [0,0,0];
    }

    addLayer(name, vertices, indices, color, normals) {
        if(normals == undefined)
            normals = null;
        var layer = new Layer(vertices, indices, color, normals);
        layer.init();
        this.layers[name] = layer;
        this.centroid = this.getCentroid();
    }

    removeLayer(name) {
        delete this.layers[name];
    }

    draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix = null, lightProjectionMatrix = null, shadowPass = false, texture = null) {
        for(var layer in this.layers) {
            if(layer == 'surface') {
                gl.polygonOffset(1, 1);
            }
            else {
                gl.polygonOffset(0, 0);
            }
            this.layers[layer].draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, shadowPass, texture);
        }
    }

    
    getCentroid() {
        var sum = [0,0,0];
        var numpts = 0;
        for(var layer in this.layers) {
            numpts += this.layers[layer].vertices.length/3;
            for(var i=0; i<this.layers[layer].vertices.length; i+=3) {
                var x = this.layers[layer].vertices[i];
                var y = this.layers[layer].vertices[i+1];
                var z = this.layers[layer].vertices[i+2];
    
                sum[0]+=x;
                sum[1]+=y;
                sum[2]+=z;
            }
        }
        return [sum[0]/numpts,sum[1]/numpts,sum[2]/numpts];
    }
}

/*
    Layers without normals (water, parks, surface)
*/
class Layer {
    constructor(vertices, indices, color, normals = null) {
        this.vertices = vertices;
        this.indices = indices;
        this.color = color;
        this.normals = normals;

        this.hasNormals = normals !== null;
    }

    init() {
        this.layerProgram = new LayerProgram();
        this.shadowProgram = new ShadowMapProgram();

        this.vertexBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.vertices));
        this.indexBuffer = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(this.indices));

        if (this.hasNormals) {
            this.normalBuffer = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(this.normals));
            // Ensure createVAO can handle normals correctly, you might need to adjust it based on your implementation
            this.vao = createVAO(gl, this.layerProgram.posAttribLoc, this.vertexBuffer, this.layerProgram.normalsAttribLoc, this.normalBuffer);
        } else {
            this.vao = createVAO(gl, this.layerProgram.posAttribLoc, this.vertexBuffer);
        }
    }

    draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, shadowPass = false, texture = null) {
        let program = shadowPass ? this.shadowProgram : this.layerProgram;
        gl.useProgram(program.program);

        // Convert matrices to Float32Array if not already
        gl.uniformMatrix4fv(program.modelLoc, false, new Float32Array(modelMatrix));
        gl.uniformMatrix4fv(program.viewLoc, false, new Float32Array(viewMatrix));
        gl.uniformMatrix4fv(program.projectionLoc, false, new Float32Array(projectionMatrix));
        gl.uniform4fv(program.colorAttribLoc, new Float32Array(this.color));

        if (shadowPass && this.hasNormals) {
            gl.uniformMatrix4fv(program.lightViewLoc, false, new Float32Array(lightViewMatrix));
            gl.uniformMatrix4fv(program.lightProjectionLoc, false, new Float32Array(lightProjectionMatrix));
        }

        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);

        gl.bindVertexArray(null);
    }
}



/*
    Event handlers
*/
window.updateRotate = function() {
    currRotate = parseInt(document.querySelector("#rotate").value);
}

window.updateLightRotate = function() {
    currLightRotate = parseInt(document.querySelector("#lightRotate").value);
}

window.updateZoom = function() {
    currZoom = parseFloat(document.querySelector("#zoom").value);
}

window.updateProjection = function() {
    currProj = document.querySelector("#projection").value;
}

window.displayShadowmap = function(e) {
    displayShadowmap = e.checked;
}

/*
    File handler
*/
window.handleFile = function(e) {
    var reader = new FileReader();
    reader.onload = function(evt) {
        var parsed = JSON.parse(evt.target.result);
        for(var layer in parsed){
            var aux = parsed[layer];
            layers.addLayer(layer, aux['coordinates'], aux['indices'], aux['color'], aux['normals']);
        }
    }
    reader.readAsText(e.files[0]);
}

/*
    Update transformation matrices
*/
function updateModelMatrix(centroid) {
    var translate = translateMatrix(-centroid[0], -centroid[1], -centroid[2]);
    var rotate = rotateYMatrix(currRotate * Math.PI / 180);
    return multiplyMatrices(translate, rotate);
}

function updateProjectionMatrix() {
    if(currProj === 'perspective') {
        return perspectiveMatrix(45 * Math.PI / 180, gl.canvas.clientWidth / gl.canvas.clientHeight, 0.1, 100.0);
    } else {
        return orthographicMatrix(-1, 1, -1, 1, 0.1, 100);
    }
}

function updateViewMatrix(centroid){
    var initialCameraPosition = [0, 0, 2];
    var lookAtCenter = add(centroid, [0, 0, -1]);
    return lookAt(initialCameraPosition, lookAtCenter, [0, 1, 0]);
}

function updateLightViewMatrix(centroid) {
    var lightDirectionNormalized = normalize([Math.sin(currLightRotate * Math.PI / 180), -1, Math.cos(currLightRotate * Math.PI / 180)]);
    var lightPosition = sub(centroid, multiplyVecByScalar(lightDirectionNormalized, 10));
    var lookAtCenter = centroid;
    return lookAt(lightPosition, lookAtCenter, [0, 1, 0]);
}

function updateLightProjectionMatrix() {
    return orthographicMatrix(-10, 10, -10, 10, 1, 20);
}


/*
    Main draw function (should call layers.draw)
*/
function draw() {
    var centroid = layers.getCentroid();
    var modelMatrix = updateModelMatrix(centroid);
    var viewMatrix = updateViewMatrix(centroid);
    var projectionMatrix = updateProjectionMatrix();
    var lightViewMatrix = updateLightViewMatrix(centroid);
    var lightProjectionMatrix = updateLightProjectionMatrix();

    // First rendering pass (Shadow map)
    fbo.start();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    layers.draw(modelMatrix, lightViewMatrix, lightProjectionMatrix, null, null, true);
    fbo.stop();

    // Clear the canvas for the second pass
    gl.clearColor(190/255, 210/255, 215/255, 1);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!displayShadowmap) {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        layers.draw(modelMatrix, viewMatrix, projectionMatrix, lightViewMatrix, lightProjectionMatrix, false, fbo.texture);
    } else {
        // Render shadowmap texture for visualization
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        renderToScreen.draw(fbo.texture);
    }

    requestAnimationFrame(draw);

}

/*
    Initialize everything
*/
function initialize() {

    var canvas = document.querySelector("#glcanvas");
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    gl = canvas.getContext("webgl2");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);

    gl.enable(gl.POLYGON_OFFSET_FILL);

    layers = new Layers();
    fbo = new FBO(currResolution);
    renderToScreen = new RenderToScreenProgram();

    window.requestAnimationFrame(draw);

}


window.onload = initialize;