const THREE = window.THREE = require('three');
const Stats = require('../lib/stats.min');
const dat = require('dat.gui');
const environments = require('../assets/environment/index');
const createVignetteBackground = require('three-vignette-background');

require('three/examples/js/loaders/GLTFLoader');
require('../lib/GLTFExporter');
require('three/examples/js/loaders/DRACOLoader');
require('three/examples/js/loaders/DDSLoader');
require('three/examples/js/controls/OrbitControls');
require('three/examples/js/loaders/RGBELoader');
require('three/examples/js/loaders/HDRCubeTextureLoader');
require('three/examples/js/pmrem/PMREMGenerator');
require('three/examples/js/pmrem/PMREMCubeUVPacker');

THREE.DRACOLoader.setDecoderPath( 'lib/draco/' );

const DEFAULT_CAMERA = '[default]';

const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// glTF texture types. `envMap` is deliberately omitted, as it's used internally
// by the loader but not part of the glTF format.
const MAP_NAMES = [
  'map',
  'aoMap',
  'emissiveMap',
  'glossinessMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
];

const Preset = {ASSET_GENERATOR: 'assetgenerator'};

module.exports = class Viewer {

  constructor (el, options) {
    this.el = el;
    this.options = options;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;

    this.originalTextureFilesize = 0;
    this.originalTotalTextureFilesize = 0;
    this.originalTextureFilesizes = {};
    this.newTextureFilesizes = {};
    this.originalFilesize = 0;

    this.state = {
      environment: options.preset === Preset.ASSET_GENERATOR
        ? 'Footprint Court (HDR)'
        : environments[1].name,
      background: false,
      playbackSpeed: 1.0,
      actionStates: {},
      camera: DEFAULT_CAMERA,
      wireframe: false,
      skeleton: false,
      grid: false,
      material: null,
      texture: null,
      quality: 1,
      compressTexture: false,
      imageFormat: null,
      resolution: 2048,
      originalTextureFilesize: "",
      newTextureFilesize: "",

      originalFilesize: "",
      newFilesize: "",

      // Lights
      addLights: true,
      exposure: 1.0,
      textureEncoding: 'sRGB',
      ambientIntensity: 0.3,
      ambientColor: 0xFFFFFF,
      directIntensity: 0.8 * Math.PI, // TODO(#116)
      directColor: 0xFFFFFF,
      bgColor1: '#ffffff',
      bgColor2: '#353535'
    };

    this.materials = {};
    this.textures = {};

    this.prevTime = 0;

    this.stats = new Stats();
    this.stats.dom.height = '48px';
    [].forEach.call(this.stats.dom.children, (child) => (child.style.display = ''));

    this.scene = new THREE.Scene();

    const fov = options.preset === Preset.ASSET_GENERATOR
      ? 0.8 * 180 / Math.PI
      : 60;
    this.defaultCamera = new THREE.PerspectiveCamera( fov, el.clientWidth / el.clientHeight, 0.01, 1000 );
    this.activeCamera = this.defaultCamera;
    this.scene.add( this.defaultCamera );


    this.canvas = document.getElementById("viewer-canvas");
    this.wrapper = document.getElementById("3d-view");
    this.renderer = window.renderer = new THREE.WebGLRenderer({antialias: true, canvas: this.canvas});
    this.renderer.physicallyCorrectLights = true;
    this.renderer.gammaOutput = true;
    this.renderer.gammaFactor = 2.2;
    this.renderer.setClearColor( 0xcccccc );
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setSize( this.wrapper.clientWidth, this.wrapper.clientHeight );



    var compare = (on) => {
      document.getElementById("original-texture").style.opacity = on ? 1 : 0;

      this.originalObject.visible = on;
      this.content.visible = !on;
    }

    document.body.onkeyup = function(e){
      if(e.keyCode == 67){
        compare(false);
      }
    }

    document.body.onkeydown = function(e){
      if(e.keyCode == 67){
        compare(true);
      }
    }




    document.getElementById("compare-btn").addEventListener('mousedown', () => {
      compare(true);
    });

    document.getElementById("compare-btn").addEventListener('mouseup', () => {
      compare(false);
    });

    this.defaultCamera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;

    this.controls = new THREE.OrbitControls( this.defaultCamera, this.renderer.domElement );
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = -10;
    this.controls.screenSpacePanning = true;

    this.background = createVignetteBackground({
      aspect: this.defaultCamera.aspect,
      grainScale: IS_IOS ? 0 : 0.001, // mattdesl/three-vignette-background#1
      colors: [this.state.bgColor1, this.state.bgColor2]
    });


    this.cameraCtrl = null;
    this.cameraFolder = null;
    this.animFolder = null;
    this.animCtrls = [];
    this.morphFolder = null;
    this.morphCtrls = [];
    this.skeletonHelpers = [];
    this.gridHelper = null;
    this.axesHelper = null;

    this.addGUI();
    if (options.kiosk) this.gui.close();

    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
    window.addEventListener('resize', this.resize.bind(this), false);
  }

  animate (time) {

    requestAnimationFrame( this.animate );

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();
    this.stats.update();
    this.mixer && this.mixer.update(dt);
    this.render();

    this.prevTime = time;

  }

  render () {

    this.renderer.render( this.scene, this.activeCamera );

  }

  resize () {
    const {clientHeight, clientWidth} = this.wrapper;

    this.defaultCamera.aspect = clientWidth / clientHeight;
    this.defaultCamera.updateProjectionMatrix();
    this.background.style({aspect: this.defaultCamera.aspect});
    this.renderer.setSize(clientWidth, clientHeight);
  }

  extractTextures(material) {
    console.log(material);
  }

  load ( url, rootPath, assetMap ) {
    document.activeElement.blur()

    const baseURL = THREE.LoaderUtils.extractUrlBase(url);
    
    window.originalFiles = {};

    this.originalTextureFilesize = 0;
    this.originalTotalTextureFilesize = 0;
    this.originalTextureFilesizes = {};
    this.newTextureFilesizes = {};
    this.originalFilesize = 0;

    Array.from(assetMap).forEach(([path, file]) => {
      this.originalFilesize += file.size;

      var paths = path.split("/");
      var baseName = paths[paths.length - 1].split(".")[0];

      window.originalFiles[baseName] = file;
      if (file.type == "image/png" || file.type == "image/jpeg") {
        this.originalTotalTextureFilesize += file.size;
        this.originalTextureFilesizes[baseName] = file.size;
      }
     //file.arrayBuffer().then(buffer => window.fileBuffers[baseName] = buffer);
    });

    this.state.originalFilesize = (this.originalFilesize / 1000/ 1000).toFixed(2) + " MB";


    // Load.
    return new Promise((resolve, reject) => {

      const manager = new THREE.LoadingManager();

      // Intercept and override relative URLs.
      manager.setURLModifier((url, path) => {

        const normalizedURL = rootPath + url
          .replace(baseURL, '')
          .replace(/^(\.?\/)/, '');

        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      });

      var _self = this;

      var loadCopy = () => { 
        
        loader.load(url, (gltf) => {

          const scene = gltf.scene || gltf.scenes[0];
          const clips = gltf.animations || [];

          this.setContent(scene, clips);
          blobURLs.forEach(URL.revokeObjectURL);

          

          resolve(gltf);

        }, undefined, reject);
      }

      const loader = new THREE.GLTFLoader(manager);
      loader.setCrossOrigin('anonymous');
      loader.setDRACOLoader( new THREE.DRACOLoader() );
      const blobURLs = [];

      _self = this;

      loader.load(url, (gltf) => {

        const scene = gltf.scene || gltf.scenes[0];
        const clips = gltf.animations || [];

        this.originalObject = scene;
        this.originalObject.visible = false;
        this.scene.add(scene);
        blobURLs.forEach(URL.revokeObjectURL);
        _self.originalTextureFilesizes = Object.assign({}, _self.originalTextureFilesizes, gltf.fileSizes);
        _self.newTextureFilesizes = Object.assign ({},_self.originalTextureFilesizes);
        window.originalFiles = Object.assign({}, window.originalFiles, gltf.fileBuffers);
        if (this.originalTotalTextureFilesize == 0) {
          for (const [key, value] of Object.entries(gltf.fileSizes)) {
            this.originalTotalTextureFilesize += value;
          }
        }
        loadCopy();

      }, undefined, reject);

    });

  }

  /**
   * @param {THREE.Object3D} object
   * @param {Array<THREE.AnimationClip} clips
   */
  setContent ( object, clips ) {

    this.clear();

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = size * 10;
    this.defaultCamera.near = size / 100;
    this.defaultCamera.far = size * 100;
    this.defaultCamera.updateProjectionMatrix();

    if (this.options.cameraPosition) {

      this.defaultCamera.position.fromArray( this.options.cameraPosition );
      this.defaultCamera.lookAt( new THREE.Vector3() );

    } else {

      this.defaultCamera.position.copy(center);
      this.defaultCamera.position.x = 0;
      this.defaultCamera.position.y = 0;
      this.defaultCamera.position.z = size;
      this.defaultCamera.lookAt(center);

    }

    this.setCamera(DEFAULT_CAMERA);

    this.controls.saveState();

    this.scene.add(object);

    this.originalObject.position.set(object.position.x, object.position.y, object.position.z);

    this.content = object;

    this.state.addLights = true;
    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      }
    });

    this.setClips(clips);

    this.updateLights();
    this.updateGUI();
    this.updateEnvironment();
    this.updateTextureEncoding();
    this.updateDisplay();
    this.updateTextures();

    window.content = this.content;
    console.info('[glTF Viewer] THREE.Scene exported as `window.content`.');
    this.printGraph(this.content);

  }

  printGraph (node) {

    console.group(' <' + node.type + '> ' + node.name);
    node.children.forEach((child) => this.printGraph(child));
    console.groupEnd();

  }

  /**
   * @param {Array<THREE.AnimationClip} clips
   */
  setClips ( clips ) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new THREE.AnimationMixer( this.content );
  }

  playAllClips () {
    this.clips.forEach((clip) => {
      this.mixer.clipAction(clip).reset().play();
      this.state.actionStates[clip.name] = true;
    });
  }

  /**
   * @param {string} name
   */
  setCamera ( name ) {
    if (name === DEFAULT_CAMERA) {
      this.controls.enabled = true;
      this.activeCamera = this.defaultCamera;
    } else {
      this.controls.enabled = false;
      this.content.traverse((node) => {
        if (node.isCamera && node.name === name) {
          this.activeCamera = node;
        }
      });
    }
  }

  updateTextureEncoding () {
    const encoding = this.state.textureEncoding === 'sRGB'
      ? THREE.sRGBEncoding
      : THREE.LinearEncoding;
    traverseMaterials(this.content, (material) => {
      if (material.map) material.map.encoding = encoding;
      if (material.emissiveMap) material.emissiveMap.encoding = encoding;
      if (material.map || material.emissiveMap) material.needsUpdate = true;
    });
  }

  updateLights () {
    const state = this.state;
    const lights = this.lights;

    if (state.addLights && !lights.length) {
      this.addLights();
    } else if (!state.addLights && lights.length) {
      this.removeLights();
    }

    this.renderer.toneMappingExposure = state.exposure;

    if (lights.length === 2) {
      lights[0].intensity = state.ambientIntensity;
      lights[0].color.setHex(state.ambientColor);
      lights[1].intensity = state.directIntensity;
      lights[1].color.setHex(state.directColor);
    }
  }

  addLights () {
    const state = this.state;

    if (this.options.preset === Preset.ASSET_GENERATOR) {
      const hemiLight = new THREE.HemisphereLight();
      hemiLight.name = 'hemi_light';
      this.scene.add(hemiLight);
      this.lights.push(hemiLight);
      return;
    }

    const light1  = new THREE.AmbientLight(state.ambientColor, state.ambientIntensity);
    light1.name = 'ambient_light';
    this.defaultCamera.add( light1 );

    const light2  = new THREE.DirectionalLight(state.directColor, state.directIntensity);
    light2.position.set(0.5, 0, 0.866); // ~60º
    light2.name = 'main_light';
    this.defaultCamera.add( light2 );

    this.lights.push(light1, light2);
  }

  removeLights () {

    this.lights.forEach((light) => light.parent.remove(light));
    this.lights.length = 0;

  }

  updateEnvironment () {

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

    this.getCubeMapTexture( environment ).then(( { envMap, cubeMap } ) => {

      if ((!envMap || !this.state.background) && this.activeCamera === this.defaultCamera) {
        this.scene.add(this.background);
      } else {
        this.scene.remove(this.background);
      }

      traverseMaterials(this.content, (material) => {
        if (material.isMeshStandardMaterial || material.isGLTFSpecularGlossinessMaterial) {
          material.envMap = envMap;
          material.needsUpdate = true;
        }
      });

      traverseMaterials(this.originalObject, (material) => {
        if (material.isMeshStandardMaterial || material.isGLTFSpecularGlossinessMaterial) {
          material.envMap = envMap;
          material.needsUpdate = true;
        }
      });

      this.scene.background = this.state.background ? cubeMap : null;

    });

  }

  getCubeMapTexture (environment) {
    const {path, format} = environment;

    // no envmap
    if ( ! path ) return Promise.resolve({envMap: null, cubeMap: null});

    const cubeMapURLs = [
      path + 'posx' + format, path + 'negx' + format,
      path + 'posy' + format, path + 'negy' + format,
      path + 'posz' + format, path + 'negz' + format
    ];

    // hdr
    if ( format === '.hdr' ) {

      return new Promise((resolve) => {

        new THREE.HDRCubeTextureLoader().load( THREE.UnsignedByteType, cubeMapURLs, ( hdrCubeMap ) => {

          var pmremGenerator = new THREE.PMREMGenerator( hdrCubeMap );
          pmremGenerator.update( this.renderer );

          var pmremCubeUVPacker = new THREE.PMREMCubeUVPacker( pmremGenerator.cubeLods );
          pmremCubeUVPacker.update( this.renderer );

          resolve( {
            envMap: pmremCubeUVPacker.CubeUVRenderTarget.texture,
            cubeMap: hdrCubeMap
          } );

        } );

      });

    }

    // standard
    const envMap = new THREE.CubeTextureLoader().load(cubeMapURLs);
    envMap.format = THREE.RGBFormat;
    return Promise.resolve( { envMap, cubeMap: envMap } );

  }

  updateTotalFilesize() {
    var textureFilesize = 0;
    for (const [key, value] of Object.entries(this.newTextureFilesizes)) {
      textureFilesize += value;
    }

    this.state.newFilesize = ((textureFilesize + this.originalFilesize - this.originalTotalTextureFilesize) / 1000 / 1000).toFixed(2) + " MB";
  }

  updateDisplay () {
    if (this.skeletonHelpers.length) {
      this.skeletonHelpers.forEach((helper) => this.scene.remove(helper));
    }

    traverseMaterials(this.content, (material) => {
      material.wireframe = this.state.wireframe;
    });

    this.content.traverse((node) => {
      if (node.isMesh && node.skeleton && this.state.skeleton) {
        const helper = new THREE.SkeletonHelper(node.skeleton.bones[0].parent);
        helper.material.linewidth = 3;
        this.scene.add(helper);
        this.skeletonHelpers.push(helper);
      }
    });

    if (this.state.grid !== Boolean(this.gridHelper)) {
      if (this.state.grid) {
        this.gridHelper = new THREE.GridHelper();
        this.axesHelper = new THREE.AxesHelper();
        this.axesHelper.renderOrder = 999;
        this.axesHelper.onBeforeRender = (renderer) => renderer.clearDepth();
        this.scene.add(this.gridHelper);
        this.scene.add(this.axesHelper);
      } else {
        this.scene.remove(this.gridHelper);
        this.scene.remove(this.axesHelper);
        this.gridHelper = null;
        this.axesHelper = null;
      }
    }
  }

  selectTexture(uuid) {
    this.state.quality = this.textures[uuid].quality;
    this.state.imageFormat = this.textures[uuid].imageFormat;
    this.state.resolution = this.textures[uuid].resolution;
    this.state.compressTexture = this.textures[uuid].compressTexture;
    this.state.originalTextureFilesize = '2 MB';



    if (this.textures[uuid].sourceImage == null) {
      this.textures[uuid].sourceImage = extractImageDataToCanvas(this.textures[uuid].textureReference.image);
    }

    var o = document.getElementById('original-texture');
    o.src = this.textures[uuid].sourceImage.toDataURL();

    //var head = 'data:image/png;base64,';
    //var imgFileSize = Math.round((this.textures[uuid].sourceImage.toDataURL().length - head.length)*3/4) ;
    //console.log(imgFileSize);

    var availableResolutions = {}
    var resolutions = [128, 256, 512, 1024, 2048, 4096];
    for (var i = 0; i < resolutions.length; i++) {
      if (resolutions[i] <= this.textures[uuid].originalResolution) {
        availableResolutions[resolutions[i]] = resolutions[i];
      }
    }

    this.updateDropdown(this.resolutionDropdown, availableResolutions);

    this.toggleCompression(this.state.compressTexture);
    this.updateTexture(uuid, this.state.quality, this.state.resolution, this.state.imageFormat, this.state.compressTexture);
  }


  updateTexture(uuid, quality, resolution, format, compressTexture) {
    this.state.quality = this.textures[uuid].quality = quality;
    this.state.resolution = this.textures[uuid].resolution = resolution;
    this.state.imageFormat = this.textures[uuid].imageFormat = format;
    this.state.compressTexture = this.textures[uuid].compressTexture = compressTexture;

    this.currentMap = uuid;
    var v = document.getElementById('current-texture');
    var newSrc = downscaleCanvas(this.textures[uuid].sourceImage, resolution, format, quality);

    this.state.originalTextureFilesize = (this.originalTextureFilesizes[this.textures[uuid].textureReference.name]/ 1000 / 1000).toFixed(3) + " MB";

    this.state.newTextureFilesize = (Math.round(newSrc.length * 1) / 1000 / 1000 * 3 / 4).toFixed(3) + " MB";

    this.textures[uuid].textureReference.image.src = newSrc;

    // Store the format so when we are exporting we can know what format it is.
    this.textures[uuid].textureReference.image.format = format;
    this.textures[uuid].textureReference.image.quality = quality;
    this.textures[uuid].textureReference.image.compressTexture = compressTexture;
    this.textures[uuid].textureReference.needsUpdate = true;


    this.newTextureFilesize.domElement.parentNode.style.display = this.state.compressTexture ? 'inherit' : 'none';

    if (this.state.compressTexture) {
      v.src = newSrc;
      this.newTextureFilesizes[this.textures[uuid].textureReference.name] = newSrc.length * 3 / 4;
    } else {
      v.src = document.getElementById('original-texture').src;
      this.textures[uuid].textureReference.image.src = v.src;
      this.newTextureFilesizes[this.textures[uuid].textureReference.name] = this.originalTextureFilesizes[this.textures[uuid].textureReference.name];
    }
    
    this.updateTotalFilesize();

  }

  selectMaterial(name) {
    this.state.material = name;
    var material = this.materials[name];


    var firstTexture = this.textureDropdownOptions[name][Object.keys(this.textureDropdownOptions[name])[0]];

    this.state.texture = firstTexture;

    this.updateDropdown(this.textureDropdown, this.textureDropdownOptions[name]);

    this.selectTexture(firstTexture);
  }

  updateDropdown(target, list){   
    var innerHTMLStr = "";
    for(var i=0; i<Object.keys(list).length; i++){
        var str = "<option value='" + list[Object.keys(list)[i]] + "'>" + Object.keys(list)[i] + "</option>";
        innerHTMLStr += str;        
    }

    if (innerHTMLStr != "") target.domElement.children[0].innerHTML = innerHTMLStr;
  }

  export() {
    var content = this.content;
    var exporter = new THREE.GLTFExporter();
    setTimeout(function(){
      exporter.parse( content, function ( gltf ) {
        saveArrayBuffer( gltf, 'scene.glb' );
      }, {binary: true} );
    }, 1000);
  }


  updateTextures() {

    var textureView = document.getElementById('texture-view');

    var fc = textureView.firstChild;

    while( fc ) {
        textureView.removeChild( fc );
        fc = textureView.firstChild;
    }

    var img = new Image();
    img.id = 'current-texture';
    document.getElementById('texture-view').appendChild(img);

    var originalImg = new Image();
    originalImg.id = 'original-texture';
    document.getElementById('texture-view').appendChild(originalImg);

    this.textureDropdownOptions = {};
    this.materialDropdownOptions = {};
    traverseMaterials(this.content, (material) => {
      this.materials[material.name] = material;
      this.textureDropdownOptions[material.name] = {};
      this.materialDropdownOptions[material.name] = material.name;

      if (material.side == THREE.DoubleSide) {
        console.log("This material was double sided, fixing.");
        material.side = THREE.FrontSide;
      }
      MAP_NAMES.forEach( (map) => {
       if (material[ map ]) {
         material[map].image.originalImage = originalImg;
         material[map].image.name = material[map].name;
         this.textures[material[map].uuid] = { textureReference: material[map], quality: 0.92, originalResolution: material[map].image.width, resolution: material[map].image.width, imageFormat: material[map].format == "1023" ? 'image/png': 'image/jpeg' , far:'bees', compressTexture: false };
         var mapName = map;
         if (map == "aoMap" || map == "roughnessMap" || map == "metalnessMap") {
           mapName = "ao / m / r"
         }
         if (map == "map") {
           mapName = "diffuse"
         }

         if (map == "normalMap") {
           mapName = "normals"
         }
         
         this.textureDropdownOptions[material.name][mapName] = material[map].uuid;
       }
      });
    });
      

    this.selectMaterial(Object.keys(this.materialDropdownOptions)[0]);
    this.updateDropdown(this.materialDropdown, this.materialDropdownOptions);

    this.materialFolder.open();

    return;
  }




  updateBackground () {
    this.background.style({colors: [this.state.bgColor1, this.state.bgColor2]});
  }

  addGUI () {

    const gui = this.gui = new dat.GUI({autoPlace: false, width: 260, hideable: true});

    // Display controls.
    const dispFolder = gui.addFolder('Display');
    const envBackgroundCtrl = dispFolder.add(this.state, 'background');
    envBackgroundCtrl.onChange(() => this.updateEnvironment());
    const wireframeCtrl = dispFolder.add(this.state, 'wireframe');
    wireframeCtrl.onChange(() => this.updateDisplay());
    const skeletonCtrl = dispFolder.add(this.state, 'skeleton');
    skeletonCtrl.onChange(() => this.updateDisplay());
    const gridCtrl = dispFolder.add(this.state, 'grid');
    gridCtrl.onChange(() => this.updateDisplay());
    dispFolder.add(this.controls, 'autoRotate');
    dispFolder.add(this.controls, 'screenSpacePanning');
    const bgColor1Ctrl = dispFolder.addColor(this.state, 'bgColor1');
    const bgColor2Ctrl = dispFolder.addColor(this.state, 'bgColor2');
    bgColor1Ctrl.onChange(() => this.updateBackground());
    bgColor2Ctrl.onChange(() => this.updateBackground());

    // Lighting controls.
    const lightFolder = gui.addFolder('Lighting');
    const encodingCtrl = lightFolder.add(this.state, 'textureEncoding', ['sRGB', 'Linear']);
    encodingCtrl.onChange(() => this.updateTextureEncoding());
    lightFolder.add(this.renderer, 'gammaOutput').onChange(() => {
      traverseMaterials(this.content, (material) => {
        material.needsUpdate = true;
      });
    });


    var toggleEl = (el, tag, on) => {
      var opacity = on ? 1 : 0.4;
      var pointerEvents = on ? "inherit" : "none;"
      var element = tag != "" ? el.domElement.getElementsByTagName(tag)[0] : el.domElement;
      element.style.opacity = opacity;
      element.style.pointerEvents = pointerEvents;
    }

    this.toggleCompression =  (shouldCompress)  => {
      toggleEl(this.resolutionDropdown, 'select', shouldCompress);
      toggleEl(this.formatDropdown, 'select', shouldCompress);
      toggleEl(this.quality, '', shouldCompress);
    }


    // Material selection
    this.materialFolder = gui.addFolder('Materials');
    this.materialDropdown = this.materialFolder.add(this.state, 'material', {}).onChange((m) => {this.selectMaterial(m)});
    this.textureDropdown = this.materialFolder.add(this.state, 'texture', {}).onChange((t) => {this.selectTexture(t)});

    this.compressTexture = this.materialFolder.add(this.state, 'compressTexture').name("compress?").listen().onChange((c) => {this.toggleCompression(c); this.updateTexture(this.currentMap, this.state.quality, this.state.resolution, this.state.imageFormat, c);});

    this.resolutionDropdown = this.materialFolder.add(this.state, 'resolution', {}).listen().onChange((r) => {this.updateTexture(this.currentMap, this.state.quality, r, this.state.imageFormat, this.state.compressTexture)});
    this.formatDropdown = this.materialFolder.add(this.state, 'imageFormat', {'jpg': 'image/jpeg', 'png': 'image/png'}).listen().onChange((f) => {this.updateTexture(this.currentMap, this.state.quality, this.state.resolution, f, this.state.compressTexture)});;
    this.quality = this.materialFolder.add(this.state, 'quality', 0, 1, 0.01).min(0.01).listen();
    this.quality.onFinishChange( (q) => this.updateTexture(this.currentMap, q, this.state.resolution, this.state.imageFormat, this.state.compressTexture));

    this.originalTextureFilesize = this.materialFolder.add(this.state, 'originalTextureFilesize').name("Original size").listen();
    this.originalTextureFilesize.domElement.style.pointerEvents = "none"
    this.originalTextureFilesize.domElement.style.opacity = 1;

    this.newTextureFilesize = this.materialFolder.add(this.state, 'newTextureFilesize').name("Compressed size").listen();
    this.newTextureFilesize.domElement.style.pointerEvents = "none";
    this.newTextureFilesize.domElement.style.opacity = 1;

    this.toggleCompression(false);




    const envMapCtrl = lightFolder.add(this.state, 'environment', environments.map((env) => env.name));
    envMapCtrl.onChange(() => this.updateEnvironment());
    [
      lightFolder.add(this.state, 'exposure', 0, 2),
      lightFolder.add(this.state, 'addLights').listen(),
      lightFolder.add(this.state, 'ambientIntensity', 0, 2),
      lightFolder.addColor(this.state, 'ambientColor'),
      lightFolder.add(this.state, 'directIntensity', 0, 4), // TODO(#116)
      lightFolder.addColor(this.state, 'directColor')
    ].forEach((ctrl) => ctrl.onChange(() => this.updateLights()));

    // Animation controls.
    this.animFolder = gui.addFolder('Animation');
    this.animFolder.domElement.style.display = 'none';
    const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
    playbackSpeedCtrl.onChange((speed) => {
      if (this.mixer) this.mixer.timeScale = speed;
    });
    this.animFolder.add({playAll: () => this.playAllClips()}, 'playAll');

    // Morph target controls.
    this.morphFolder = gui.addFolder('Morph Targets');
    this.morphFolder.domElement.style.display = 'none';

    // Camera controls.
    this.cameraFolder = gui.addFolder('Cameras');
    this.cameraFolder.domElement.style.display = 'none';


    // Export


    this.exportFolder = gui.addFolder('Details');
    this.exportFolder.open();
    var exportBtn = { Export: () => { this.export() } };

    this.originalFilesizeGui = this.exportFolder.add(this.state, 'originalFilesize').name("Original size").listen();
    this.originalFilesizeGui.domElement.style.pointerEvents = "none"
    this.originalFilesizeGui.domElement.style.opacity = 1;

    this.newFilesizeGui = this.exportFolder.add(this.state, 'newFilesize').name("Approx new size").listen();
    this.newFilesizeGui.domElement.style.pointerEvents = "none";
    this.newFilesizeGui.domElement.style.opacity = 1;

    this.exportFolder.add(exportBtn,'Export');
    this.exportFolder.domElement.addEventListener('click', () => {
     // this.export();
    });

    // Stats.
    //const perfFolder = gui.addFolder('Performance');
    //const perfLi = document.createElement('li');
    //this.stats.dom.style.position = 'static';
    //perfLi.appendChild(this.stats.dom);
    //perfLi.classList.add('gui-stats');
    //perfFolder.__ul.appendChild( perfLi );

    const guiWrap = document.createElement('div');
    this.el.appendChild( guiWrap );
    guiWrap.classList.add('gui-wrap');
    guiWrap.appendChild(gui.domElement);
    gui.open();

  }

  updateGUI () {
    this.cameraFolder.domElement.style.display = 'none';

    this.morphCtrls.forEach((ctrl) => ctrl.remove());
    this.morphCtrls.length = 0;
    this.morphFolder.domElement.style.display = 'none';

    this.animCtrls.forEach((ctrl) => ctrl.remove());
    this.animCtrls.length = 0;
    this.animFolder.domElement.style.display = 'none';

    const cameraNames = [];
    const morphMeshes = [];
    this.content.traverse((node) => {
      if (node.isMesh && node.morphTargetInfluences) {
        morphMeshes.push(node);
      }
      if (node.isCamera) {
        node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
        cameraNames.push(node.name);
      }
    });

    if (cameraNames.length) {
      this.cameraFolder.domElement.style.display = '';
      if (this.cameraCtrl) this.cameraCtrl.remove();
      const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
      this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
      this.cameraCtrl.onChange((name) => this.setCamera(name));
    }

    if (morphMeshes.length) {
      this.morphFolder.domElement.style.display = '';
      morphMeshes.forEach((mesh) => {
        if (mesh.morphTargetInfluences.length) {
          const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
          this.morphCtrls.push(nameCtrl);
        }
        for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
          const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1, 0.01).listen();
          Object.keys(mesh.morphTargetDictionary).forEach((key) => {
            if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
          });
          this.morphCtrls.push(ctrl);
        }
      });
    }

    if (this.clips.length) {
      this.animFolder.domElement.style.display = '';
      const actionStates = this.state.actionStates = {};
      this.clips.forEach((clip, clipIndex) => {
        // Autoplay the first clip.
        let action;
        if (clipIndex === 0) {
          actionStates[clip.name] = true;
          action = this.mixer.clipAction(clip);
          action.play();
        } else {
          actionStates[clip.name] = false;
        }

        // Play other clips when enabled.
        const ctrl = this.animFolder.add(actionStates, clip.name).listen();
        ctrl.onChange((playAnimation) => {
          action = action || this.mixer.clipAction(clip);
          action.setEffectiveTimeScale(1);
          playAnimation ? action.play() : action.stop();
        });
        this.animCtrls.push(ctrl);
      });
    }
  }

  clear () {

    if ( !this.content ) return;

    this.scene.remove( this.content );

    // dispose geometry
    this.content.traverse((node) => {

      if ( !node.isMesh ) return;

      node.geometry.dispose();

    } );

    // dispose textures
    traverseMaterials( this.content, (material) => {

      MAP_NAMES.forEach( (map) => {

        if (material[ map ]) material[ map ].dispose();

      } );

    } );

  }

};

// function getDataUri(url, callback) {
//     var image = new Image();

//     image.onload = function () {
//         var canvas = document.createElement('canvas');
//         canvas.width = this.naturalWidth; // or 'width' if you want a special/scaled size
//         canvas.height = this.naturalHeight; // or 'height' if you want a special/scaled size

//         canvas.getContext('2d').drawImage(this, 0, 0);

//         // Get raw image data
//         callback(canvas.toDataURL('image/png').replace(/^data:image\/(png|jpg);base64,/, ''));

//         // ... or get as Data URI
//         callback(canvas.toDataURL('image/png'));
//     };

//     image.src = url;
// }



function save( blob, filename ) {
  var link = document.createElement('a');
  link.href = URL.createObjectURL( blob );
  link.download = filename;
  link.click();

}

function saveString( text, filename ) {

  save( new Blob( [ text ], { type: 'text/plain' } ), filename );

}

function saveArrayBuffer( buffer, filename ) {

  save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );

}

function extractImageDataToCanvas(image) {


    // Create a temporary canvas to draw the downscaled image on.
    canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    // Draw the downscaled image on the canvas and return the new data URL.
    ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

// Take an image URL, downscale it to the given width, and return a new image URL.
function downscaleImage(image, newWidth, imageType, imageArguments) {
    "use strict";
    var oldWidth, oldHeight, newHeight, canvas, ctx, newDataUrl;

    // Provide default values
    imageType = imageType || "image/jpeg";

    // Create a temporary image so that we can compute the height of the downscaled image.
   // image = new Image();
    //image.src = dataUrl;
    oldWidth = image.width;
    oldHeight = image.height;
    newHeight = Math.floor(oldHeight / oldWidth * newWidth)

    // Create a temporary canvas to draw the downscaled image on.
    canvas = document.createElement("canvas");
    canvas.width = newWidth;
    canvas.height = newHeight;

    // Draw the downscaled image on the canvas and return the new data URL.
    ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, newWidth, newHeight);
    newDataUrl = canvas.toDataURL(imageType, imageArguments);
    return newDataUrl;
}

function downscaleCanvas(canvas, newWidth, imageType, imageArguments) {
    "use strict";
    var oldWidth, oldHeight, newHeight, canvas, ctx, newDataUrl;

    // Provide default values
    imageType = imageType || "image/jpeg";

    // Create a temporary image so that we can compute the height of the downscaled image.
   // image = new Image();
    //image.src = dataUrl;
    oldWidth = canvas.width;
    oldHeight = canvas.height;
    newHeight = Math.floor(oldHeight / oldWidth * newWidth)

    // Create a temporary canvas to draw the downscaled image on.
    var newCanvas = document.createElement("canvas");
    newCanvas.width = newWidth;
    newCanvas.height = newHeight;

    // Draw the downscaled image on the canvas and return the new data URL.
    ctx = newCanvas.getContext("2d");
    ctx.drawImage(canvas, 0, 0, newWidth, newHeight);
    newDataUrl = newCanvas.toDataURL(imageType, imageArguments);
    return newDataUrl;
}




function traverseMaterials (object, callback) {
  object.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach(callback);
  });
}
