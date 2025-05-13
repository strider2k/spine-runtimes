/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated July 28, 2023. Replaces all prior versions.
 *
 * Copyright (c) 2013-2023, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software or
 * otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THE
 * SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/
import * as Phaser from "phaser";
import { SPINE_ATLAS_CACHE_KEY, SPINE_GAME_OBJECT_TYPE, SPINE_SKELETON_DATA_FILE_TYPE, SPINE_ATLAS_FILE_TYPE, SPINE_SKELETON_FILE_CACHE_KEY as SPINE_SKELETON_DATA_CACHE_KEY } from "./keys.js";
import { AtlasAttachmentLoader, GLTexture, SceneRenderer, Skeleton, SkeletonBinary, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-webgl";
import { SpineGameObject } from "./SpineGameObject.js";
import { CanvasTexture, SkeletonRenderer } from "@esotericsoftware/spine-canvas";
/**
 * {@link ScenePlugin} implementation adding Spine Runtime capabilities to a scene.
 *
 * The scene's {@link LoaderPlugin} (`Scene.load`) gets these additional functions:
 * * `spineBinary(key: string, url: string, xhrSettings?: XHRSettingsObject)`: loads a skeleton binary `.skel` file from the `url`.
 * * `spineJson(key: string, url: string, xhrSettings?: XHRSettingsObject)`: loads a skeleton binary `.skel` file from the `url`.
 * * `spineAtlas(key: string, url: string, premultipliedAlpha: boolean = true, xhrSettings?: XHRSettingsObject)`: loads a texture atlas `.atlas` file from the `url` as well as its correponding texture atlas page images.
 *
 * The scene's {@link GameObjectFactory} (`Scene.add`) gets these additional functions:
 * * `spine(x: number, y: number, dataKey: string, atlasKey: string, boundsProvider: SpineGameObjectBoundsProvider = SetupPoseBoundsProvider())`:
 *    creates a new {@link SpineGameObject} from the data and atlas at position `(x, y)`, using the {@link BoundsProvider} to calculate its bounding box. The object is automatically added to the scene.
 *
 * The scene's {@link GameObjectCreator} (`Scene.make`) gets these additional functions:
 * * `spine(config: SpineGameObjectConfig)`: creates a new {@link SpineGameObject} from the given configuration object.
 *
 * The plugin has additional public methods to work with Spine Runtime core API objects:
 * * `getAtlas(atlasKey: string)`: returns the {@link TextureAtlas} instance for the given atlas key.
 * * `getSkeletonData(skeletonDataKey: string)`: returns the {@link SkeletonData} instance for the given skeleton data key.
 * * `createSkeleton(skeletonDataKey: string, atlasKey: string, premultipliedAlpha: boolean = true)`: creates a new {@link Skeleton} instance from the given skeleton data and atlas key.
 * * `isPremultipliedAlpha(atlasKey: string)`: returns `true` if the atlas with the given key has premultiplied alpha.
 */
export class SpinePlugin extends Phaser.Plugins.ScenePlugin {
    game;
    isWebGL;
    gl;
    static gameWebGLRenderer = null;
    get webGLRenderer() {
        return SpinePlugin.gameWebGLRenderer;
    }
    canvasRenderer;
    phaserRenderer;
    skeletonDataCache;
    atlasCache;
    constructor(scene, pluginManager, pluginKey) {
        super(scene, pluginManager, pluginKey);
        this.game = pluginManager.game;
        this.isWebGL = this.game.config.renderType === 2;
        this.gl = this.isWebGL ? this.game.renderer.gl : null;
        this.phaserRenderer = this.game.renderer;
        this.canvasRenderer = null;
        this.skeletonDataCache = this.game.cache.addCustom(SPINE_SKELETON_DATA_CACHE_KEY);
        this.atlasCache = this.game.cache.addCustom(SPINE_ATLAS_CACHE_KEY);
        let skeletonJsonFileCallback = function (key, url, xhrSettings) {
            let file = new SpineSkeletonDataFile(this, key, url, SpineSkeletonDataFileType.json, xhrSettings);
            this.addFile(file.files);
            return this;
        };
        pluginManager.registerFileType("spineJson", skeletonJsonFileCallback, scene);
        let skeletonBinaryFileCallback = function (key, url, xhrSettings) {
            let file = new SpineSkeletonDataFile(this, key, url, SpineSkeletonDataFileType.binary, xhrSettings);
            this.addFile(file.files);
            return this;
        };
        pluginManager.registerFileType("spineBinary", skeletonBinaryFileCallback, scene);
        let atlasFileCallback = function (key, url, premultipliedAlpha, xhrSettings) {
            let file = new SpineAtlasFile(this, key, url, premultipliedAlpha, xhrSettings);
            this.addFile(file.files);
            return this;
        };
        pluginManager.registerFileType("spineAtlas", atlasFileCallback, scene);
        let addSpineGameObject = function (x, y, dataKey, atlasKey, boundsProvider) {
            if (this.scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
                this.scene.sys.renderer.pipelines.clear();
            }
            const spinePlugin = this.scene.sys[pluginKey];
            let gameObject = new SpineGameObject(this.scene, spinePlugin, x, y, dataKey, atlasKey, boundsProvider);
            this.displayList.add(gameObject);
            this.updateList.add(gameObject);
            if (this.scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
                this.scene.sys.renderer.pipelines.rebind();
            }
            return gameObject;
        };
        let makeSpineGameObject = function (config, addToScene = false) {
            if (this.scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
                this.scene.sys.renderer.pipelines.clear();
            }
            let x = config.x ? config.x : 0;
            let y = config.y ? config.y : 0;
            let boundsProvider = config.boundsProvider ? config.boundsProvider : undefined;
            const spinePlugin = this.scene.sys[pluginKey];
            let gameObject = new SpineGameObject(this.scene, spinePlugin, x, y, config.dataKey, config.atlasKey, boundsProvider);
            if (addToScene !== undefined) {
                config.add = addToScene;
            }
            if (this.scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
                this.scene.sys.renderer.pipelines.rebind();
            }
            return Phaser.GameObjects.BuildGameObject(this.scene, gameObject, config);
        };
        pluginManager.registerGameObject(window.SPINE_GAME_OBJECT_TYPE ? window.SPINE_GAME_OBJECT_TYPE : SPINE_GAME_OBJECT_TYPE, addSpineGameObject, makeSpineGameObject);
    }
    static rendererId = 0;
    boot() {
        Skeleton.yDown = true;
        if (this.isWebGL) {
            if (!SpinePlugin.gameWebGLRenderer) {
                SpinePlugin.gameWebGLRenderer = new SceneRenderer(this.game.renderer.canvas, this.gl, true);
            }
            this.onResize();
            this.game.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
        }
        else {
            if (!this.canvasRenderer) {
                this.canvasRenderer = new SkeletonRenderer(this.scene.sys.context);
            }
        }
        var eventEmitter = this.systems.events;
        eventEmitter.once('shutdown', this.shutdown, this);
        eventEmitter.once('destroy', this.destroy, this);
        this.game.events.once('destroy', this.gameDestroy, this);
    }
    onResize() {
        var phaserRenderer = this.game.renderer;
        var sceneRenderer = this.webGLRenderer;
        if (phaserRenderer && sceneRenderer) {
            var viewportWidth = phaserRenderer.width;
            var viewportHeight = phaserRenderer.height;
            sceneRenderer.camera.position.x = viewportWidth / 2;
            sceneRenderer.camera.position.y = viewportHeight / 2;
            sceneRenderer.camera.up.y = -1;
            sceneRenderer.camera.direction.z = 1;
            sceneRenderer.camera.setViewport(viewportWidth, viewportHeight);
        }
    }
    shutdown() {
        this.systems.events.off("shutdown", this.shutdown, this);
        if (this.isWebGL) {
            this.game.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
        }
    }
    destroy() {
        this.shutdown();
    }
    gameDestroy() {
        this.pluginManager.removeGameObject(window.SPINE_GAME_OBJECT_TYPE ? window.SPINE_GAME_OBJECT_TYPE : SPINE_GAME_OBJECT_TYPE, true, true);
        if (this.webGLRenderer)
            this.webGLRenderer.dispose();
        SpinePlugin.gameWebGLRenderer = null;
    }
    /** Returns the TextureAtlas instance for the given key */
    getAtlas(atlasKey) {
        let atlas;
        if (this.atlasCache.exists(atlasKey)) {
            atlas = this.atlasCache.get(atlasKey);
        }
        else {
            let atlasFile = this.game.cache.text.get(atlasKey);
            atlas = new TextureAtlas(atlasFile.data);
            if (this.isWebGL) {
                let gl = this.gl;
                const phaserUnpackPmaValue = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
                if (phaserUnpackPmaValue)
                    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                for (let atlasPage of atlas.pages) {
                    atlasPage.setTexture(new GLTexture(gl, this.game.textures.get(atlasKey + "!" + atlasPage.name).getSourceImage(), false));
                }
                if (phaserUnpackPmaValue)
                    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            }
            else {
                for (let atlasPage of atlas.pages) {
                    atlasPage.setTexture(new CanvasTexture(this.game.textures.get(atlasKey + "!" + atlasPage.name).getSourceImage()));
                }
            }
            this.atlasCache.add(atlasKey, atlas);
        }
        return atlas;
    }
    /** Returns whether the TextureAtlas uses premultiplied alpha */
    isAtlasPremultiplied(atlasKey) {
        let atlasFile = this.game.cache.text.get(atlasKey);
        if (!atlasFile)
            return false;
        return atlasFile.premultipliedAlpha;
    }
    /** Returns the SkeletonData instance for the given data and atlas key */
    getSkeletonData(dataKey, atlasKey) {
        const atlas = this.getAtlas(atlasKey);
        const combinedKey = dataKey + atlasKey;
        let skeletonData;
        if (this.skeletonDataCache.exists(combinedKey)) {
            skeletonData = this.skeletonDataCache.get(combinedKey);
        }
        else {
            if (this.game.cache.json.exists(dataKey)) {
                let jsonFile = this.game.cache.json.get(dataKey);
                let json = new SkeletonJson(new AtlasAttachmentLoader(atlas));
                skeletonData = json.readSkeletonData(jsonFile);
            }
            else {
                let binaryFile = this.game.cache.binary.get(dataKey);
                let binary = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
                skeletonData = binary.readSkeletonData(new Uint8Array(binaryFile));
            }
            this.skeletonDataCache.add(combinedKey, skeletonData);
        }
        return skeletonData;
    }
    /** Creates a new Skeleton instance from the data and atlas. */
    createSkeleton(dataKey, atlasKey) {
        return new Skeleton(this.getSkeletonData(dataKey, atlasKey));
    }
}
var SpineSkeletonDataFileType;
(function (SpineSkeletonDataFileType) {
    SpineSkeletonDataFileType[SpineSkeletonDataFileType["json"] = 0] = "json";
    SpineSkeletonDataFileType[SpineSkeletonDataFileType["binary"] = 1] = "binary";
})(SpineSkeletonDataFileType || (SpineSkeletonDataFileType = {}));
class SpineSkeletonDataFile extends Phaser.Loader.MultiFile {
    fileType;
    constructor(loader, key, url, fileType, xhrSettings) {
        if (typeof key !== "string") {
            const config = key;
            key = config.key;
            url = config.url;
            fileType = config.type === "spineJson" ? SpineSkeletonDataFileType.json : SpineSkeletonDataFileType.binary;
            xhrSettings = config.xhrSettings;
        }
        let file = null;
        let isJson = fileType == SpineSkeletonDataFileType.json;
        if (isJson) {
            file = new Phaser.Loader.FileTypes.JSONFile(loader, {
                key: key,
                url: url,
                extension: "json",
                xhrSettings: xhrSettings,
            });
        }
        else {
            file = new Phaser.Loader.FileTypes.BinaryFile(loader, {
                key: key,
                url: url,
                extension: "skel",
                xhrSettings: xhrSettings,
            });
        }
        super(loader, SPINE_SKELETON_DATA_FILE_TYPE, key, [file]);
        this.fileType = fileType;
    }
    onFileComplete(file) {
        this.pending--;
    }
    addToCache() {
        if (this.isReadyToProcess())
            this.files[0].addToCache();
    }
}
class SpineAtlasFile extends Phaser.Loader.MultiFile {
    premultipliedAlpha;
    constructor(loader, key, url, premultipliedAlpha, xhrSettings) {
        if (typeof key !== "string") {
            const config = key;
            key = config.key;
            url = config.url;
            premultipliedAlpha = config.premultipliedAlpha;
            xhrSettings = config.xhrSettings;
        }
        super(loader, SPINE_ATLAS_FILE_TYPE, key, [
            new Phaser.Loader.FileTypes.TextFile(loader, {
                key: key,
                url: url,
                xhrSettings: xhrSettings,
                extension: "atlas"
            })
        ]);
        this.premultipliedAlpha = premultipliedAlpha;
    }
    onFileComplete(file) {
        if (this.files.indexOf(file) != -1) {
            this.pending--;
            if (file.type == "text") {
                var lines = file.data.split(/\r\n|\r|\n/);
                let textures = [];
                textures.push(lines[0]);
                for (var t = 1; t < lines.length; t++) {
                    var line = lines[t];
                    if (line.trim() === '' && t < lines.length - 1) {
                        line = lines[t + 1];
                        textures.push(line);
                    }
                }
                let basePath = file.src.match(/^.*\//) ?? "";
                if (this.loader.path && this.loader.path.length > 0 && basePath.toString().startsWith(this.loader.path)) {
                    basePath = basePath.toString().slice(this.loader.path.length);
                }
                for (var i = 0; i < textures.length; i++) {
                    var url = basePath + textures[i];
                    var key = file.key + "!" + textures[i];
                    var image = new Phaser.Loader.FileTypes.ImageFile(this.loader, key, url);
                    if (!this.loader.keyExists(image)) {
                        this.addToMultiFile(image);
                        this.loader.addFile(image);
                    }
                }
            }
        }
    }
    addToCache() {
        if (this.isReadyToProcess()) {
            let textureManager = this.loader.textureManager;
            for (let file of this.files) {
                if (file.type == "image") {
                    if (!textureManager.exists(file.key)) {
                        textureManager.addImage(file.key, file.data);
                    }
                }
                else {
                    this.premultipliedAlpha = this.premultipliedAlpha ?? (file.data.indexOf("pma: true") >= 0 || file.data.indexOf("pma:true") >= 0);
                    file.data = {
                        data: file.data,
                        premultipliedAlpha: this.premultipliedAlpha,
                    };
                    file.addToCache();
                }
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3BpbmVQbHVnaW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvU3BpbmVQbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OzsrRUEyQitFO0FBRS9FLE9BQU8sS0FBSyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQ2pDLE9BQU8sRUFBRSxxQkFBcUIsRUFBRSxzQkFBc0IsRUFBRSw2QkFBNkIsRUFBRSxxQkFBcUIsRUFBRSw2QkFBNkIsSUFBSSw2QkFBNkIsRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUNoTSxPQUFPLEVBQUUscUJBQXFCLEVBQUUsU0FBUyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsY0FBYyxFQUFnQixZQUFZLEVBQUUsWUFBWSxFQUFFLE1BQU0sK0JBQStCLENBQUE7QUFDbkssT0FBTyxFQUFFLGVBQWUsRUFBaUMsTUFBTSxzQkFBc0IsQ0FBQztBQUN0RixPQUFPLEVBQUUsYUFBYSxFQUFFLGdCQUFnQixFQUFFLE1BQU0sZ0NBQWdDLENBQUM7QUFtQmpGOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQW9CRztBQUNILE1BQU0sT0FBTyxXQUFZLFNBQVEsTUFBTSxDQUFDLE9BQU8sQ0FBQyxXQUFXO0lBQzFELElBQUksQ0FBYztJQUNWLE9BQU8sQ0FBVTtJQUN6QixFQUFFLENBQStCO0lBQ2pDLE1BQU0sQ0FBQyxpQkFBaUIsR0FBeUIsSUFBSSxDQUFDO0lBQ3RELElBQUksYUFBYTtRQUNoQixPQUFPLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQztJQUN0QyxDQUFDO0lBQ0QsY0FBYyxDQUEwQjtJQUN4QyxjQUFjLENBQThFO0lBQ3BGLGlCQUFpQixDQUF5QjtJQUMxQyxVQUFVLENBQXlCO0lBRTNDLFlBQWEsS0FBbUIsRUFBRSxhQUEyQyxFQUFFLFNBQWlCO1FBQy9GLEtBQUssQ0FBQyxLQUFLLEVBQUUsYUFBYSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxJ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LENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7d0JBQ3RDLGNBQWMsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7b0JBQzlDLENBQUM7Z0JBQ0YsQ0FBQztxQkFBTSxDQUFDO29CQUNQLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsa0JBQWtCLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7b0JBQ2pJLElBQUksQ0FBQyxJQUFJLEdBQUc7d0JBQ1gsSUFBSSxFQUFFLElBQUksQ0FBQyxJQUFJO3dCQUNmLGtCQUFrQixFQUFFLElBQUksQ0FBQyxrQkFBa0I7cUJBQzNDLENBQUM7b0JBQ0YsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNuQixDQUFDO1lBQ0YsQ0FBQztRQUNGLENBQUM7SUFDRixDQUFDO0NBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyIvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gKiBTcGluZSBSdW50aW1lcyBMaWNlbnNlIEFncmVlbWVudFxuICogTGFzdCB1cGRhdGVkIEp1bHkgMjgsIDIwMjMuIFJlcGxhY2VzIGFsbCBwcmlvciB2ZXJzaW9ucy5cbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTMtMjAyMywgRXNvdGVyaWMgU29mdHdhcmUgTExDXG4gKlxuICogSW50ZWdyYXRpb24gb2YgdGhlIFNwaW5lIFJ1bnRpbWVzIGludG8gc29mdHdhcmUgb3Igb3RoZXJ3aXNlIGNyZWF0aW5nXG4gKiBkZXJpdmF0aXZlIHdvcmtzIG9mIHRoZSBTcGluZSBSdW50aW1lcyBpcyBwZXJtaXR0ZWQgdW5kZXIgdGhlIHRlcm1zIGFuZFxuICogY29uZGl0aW9ucyBvZiBTZWN0aW9uIDIgb2YgdGhlIFNwaW5lIEVkaXRvciBMaWNlbnNlIEFncmVlbWVudDpcbiAqIGh0dHA6Ly9lc290ZXJpY3NvZnR3YXJlLmNvbS9zcGluZS1lZGl0b3ItbGljZW5zZVxuICpcbiAqIE90aGVyd2lzZSwgaXQgaXMgcGVybWl0dGVkIHRvIGludGVncmF0ZSB0aGUgU3BpbmUgUnVudGltZXMgaW50byBzb2Z0d2FyZSBvclxuICogb3RoZXJ3aXNlIGNyZWF0ZSBkZXJpdmF0aXZlIHdvcmtzIG9mIHRoZSBTcGluZSBSdW50aW1lcyAoY29sbGVjdGl2ZWx5LFxuICogXCJQcm9kdWN0c1wiKSwgcHJvdmlkZWQgdGhhdCBlYWNoIHVzZXIgb2YgdGhlIFByb2R1Y3RzIG11c3Qgb2J0YWluIHRoZWlyIG93blxuICogU3BpbmUgRWRpdG9yIGxpY2Vuc2UgYW5kIHJlZGlzdHJpYnV0aW9uIG9mIHRoZSBQcm9kdWN0cyBpbiBhbnkgZm9ybSBtdXN0XG4gKiBpbmNsdWRlIHRoaXMgbGljZW5zZSBhbmQgY29weXJpZ2h0IG5vdGljZS5cbiAqXG4gKiBUSEUgU1BJTkUgUlVOVElNRVMgQVJFIFBST1ZJREVEIEJZIEVTT1RFUklDIFNPRlRXQVJFIExMQyBcIkFTIElTXCIgQU5EIEFOWVxuICogRVhQUkVTUyBPUiBJTVBMSUVEIFdBUlJBTlRJRVMsIElOQ0xVRElORywgQlVUIE5PVCBMSU1JVEVEIFRPLCBUSEUgSU1QTElFRFxuICogV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFkgQU5EIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFSRVxuICogRElTQ0xBSU1FRC4gSU4gTk8gRVZFTlQgU0hBTEwgRVNPVEVSSUMgU09GVFdBUkUgTExDIEJFIExJQUJMRSBGT1IgQU5ZXG4gKiBESVJFQ1QsIElORElSRUNULCBJTkNJREVOVEFMLCBTUEVDSUFMLCBFWEVNUExBUlksIE9SIENPTlNFUVVFTlRJQUwgREFNQUdFU1xuICogKElOQ0xVRElORywgQlVUIE5PVCBMSU1JVEVEIFRPLCBQUk9DVVJFTUVOVCBPRiBTVUJTVElUVVRFIEdPT0RTIE9SIFNFUlZJQ0VTLFxuICogQlVTSU5FU1MgSU5URVJSVVBUSU9OLCBPUiBMT1NTIE9GIFVTRSwgREFUQSwgT1IgUFJPRklUUykgSE9XRVZFUiBDQVVTRUQgQU5EXG4gKiBPTiBBTlkgVEhFT1JZIE9GIExJQUJJTElUWSwgV0hFVEhFUiBJTiBDT05UUkFDVCwgU1RSSUNUIExJQUJJTElUWSwgT1IgVE9SVFxuICogKElOQ0xVRElORyBORUdMSUdFTkNFIE9SIE9USEVSV0lTRSkgQVJJU0lORyBJTiBBTlkgV0FZIE9VVCBPRiBUSEUgVVNFIE9GIFRIRVxuICogU1BJTkUgUlVOVElNRVMsIEVWRU4gSUYgQURWSVNFRCBPRiBUSEUgUE9TU0lCSUxJVFkgT0YgU1VDSCBEQU1BR0UuXG4gKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbmltcG9ydCAqIGFzIFBoYXNlciBmcm9tIFwicGhhc2VyXCI7XG5pbXBvcnQgeyBTUElORV9BVExBU19DQUNIRV9LRVksIFNQSU5FX0dBTUVfT0JKRUNUX1RZUEUsIFNQSU5FX1NLRUxFVE9OX0RBVEFfRklMRV9UWVBFLCBTUElORV9BVExBU19GSUxFX1RZUEUsIFNQSU5FX1NLRUxFVE9OX0ZJTEVfQ0FDSEVfS0VZIGFzIFNQSU5FX1NLRUxFVE9OX0RBVEFfQ0FDSEVfS0VZIH0gZnJvbSBcIi4va2V5cy5qc1wiO1xuaW1wb3J0IHsgQXRsYXNBdHRhY2htZW50TG9hZGVyLCBHTFRleHR1cmUsIFNjZW5lUmVuZGVyZXIsIFNrZWxldG9uLCBTa2VsZXRvbkJpbmFyeSwgU2tlbGV0b25EYXRhLCBTa2VsZXRvbkpzb24sIFRleHR1cmVBdGxhcyB9IGZyb20gXCJAZXNvdGVyaWNzb2Z0d2FyZS9zcGluZS13ZWJnbFwiXG5pbXBvcnQgeyBTcGluZUdhbWVPYmplY3QsIFNwaW5lR2FtZU9iamVjdEJvdW5kc1Byb3ZpZGVyIH0gZnJvbSBcIi4vU3BpbmVHYW1lT2JqZWN0LmpzXCI7XG5pbXBvcnQgeyBDYW52YXNUZXh0dXJlLCBTa2VsZXRvblJlbmRlcmVyIH0gZnJvbSBcIkBlc290ZXJpY3NvZnR3YXJlL3NwaW5lLWNhbnZhc1wiO1xuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gb2JqZWN0IHVzZWQgd2hlbiBjcmVhdGluZyB7QGxpbmsgU3BpbmVHYW1lT2JqZWN0fSBpbnN0YW5jZXMgdmlhIGEgc2NlbmUnc1xuICoge0BsaW5rIEdhbWVPYmplY3RDcmVhdG9yfSAoYFNjZW5lLm1ha2VgKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGluZUdhbWVPYmplY3RDb25maWcgZXh0ZW5kcyBQaGFzZXIuVHlwZXMuR2FtZU9iamVjdHMuR2FtZU9iamVjdENvbmZpZyB7XG5cdC8qKiBUaGUgeC1wb3NpdGlvbiBvZiB0aGUgb2JqZWN0LCBvcHRpb25hbCwgZGVmYXVsdDogMCAqL1xuXHR4PzogbnVtYmVyLFxuXHQvKiogVGhlIHktcG9zaXRpb24gb2YgdGhlIG9iamVjdCwgb3B0aW9uYWwsIGRlZmF1bHQ6IDAgKi9cblx0eT86IG51bWJlcixcblx0LyoqIFRoZSBza2VsZXRvbiBkYXRhIGtleSAqL1xuXHRkYXRhS2V5OiBzdHJpbmcsXG5cdC8qKiBUaGUgYXRsYXMga2V5ICovXG5cdGF0bGFzS2V5OiBzdHJpbmdcblx0LyoqIFRoZSBib3VuZHMgcHJvdmlkZXIsIG9wdGlvbmFsLCBkZWZhdWx0OiBgU2V0dXBQb3NlQm91bmRzUHJvdmlkZXJgICovXG5cdGJvdW5kc1Byb3ZpZGVyPzogU3BpbmVHYW1lT2JqZWN0Qm91bmRzUHJvdmlkZXJcbn1cblxuLyoqXG4gKiB7QGxpbmsgU2NlbmVQbHVnaW59IGltcGxlbWVudGF0aW9uIGFkZGluZyBTcGluZSBSdW50aW1lIGNhcGFiaWxpdGllcyB0byBhIHNjZW5lLlxuICpcbiAqIFRoZSBzY2VuZSdzIHtAbGluayBMb2FkZXJQbHVnaW59IChgU2NlbmUubG9hZGApIGdldHMgdGhlc2UgYWRkaXRpb25hbCBmdW5jdGlvbnM6XG4gKiAqIGBzcGluZUJpbmFyeShrZXk6IHN0cmluZywgdXJsOiBzdHJpbmcsIHhoclNldHRpbmdzPzogWEhSU2V0dGluZ3NPYmplY3QpYDogbG9hZHMgYSBza2VsZXRvbiBiaW5hcnkgYC5za2VsYCBmaWxlIGZyb20gdGhlIGB1cmxgLlxuICogKiBgc3BpbmVKc29uKGtleTogc3RyaW5nLCB1cmw6IHN0cmluZywgeGhyU2V0dGluZ3M/OiBYSFJTZXR0aW5nc09iamVjdClgOiBsb2FkcyBhIHNrZWxldG9uIGJpbmFyeSBgLnNrZWxgIGZpbGUgZnJvbSB0aGUgYHVybGAuXG4gKiAqIGBzcGluZUF0bGFzKGtleTogc3RyaW5nLCB1cmw6IHN0cmluZywgcHJlbXVsdGlwbGllZEFscGhhOiBib29sZWFuID0gdHJ1ZSwgeGhyU2V0dGluZ3M/OiBYSFJTZXR0aW5nc09iamVjdClgOiBsb2FkcyBhIHRleHR1cmUgYXRsYXMgYC5hdGxhc2AgZmlsZSBmcm9tIHRoZSBgdXJsYCBhcyB3ZWxsIGFzIGl0cyBjb3JyZXBvbmRpbmcgdGV4dHVyZSBhdGxhcyBwYWdlIGltYWdlcy5cbiAqXG4gKiBUaGUgc2NlbmUncyB7QGxpbmsgR2FtZU9iamVjdEZhY3Rvcnl9IChgU2NlbmUuYWRkYCkgZ2V0cyB0aGVzZSBhZGRpdGlvbmFsIGZ1bmN0aW9uczpcbiAqICogYHNwaW5lKHg6IG51bWJlciwgeTogbnVtYmVyLCBkYXRhS2V5OiBzdHJpbmcsIGF0bGFzS2V5OiBzdHJpbmcsIGJvdW5kc1Byb3ZpZGVyOiBTcGluZUdhbWVPYmplY3RCb3VuZHNQcm92aWRlciA9IFNldHVwUG9zZUJvdW5kc1Byb3ZpZGVyKCkpYDpcbiAqICAgIGNyZWF0ZXMgYSBuZXcge0BsaW5rIFNwaW5lR2FtZU9iamVjdH0gZnJvbSB0aGUgZGF0YSBhbmQgYXRsYXMgYXQgcG9zaXRpb24gYCh4LCB5KWAsIHVzaW5nIHRoZSB7QGxpbmsgQm91bmRzUHJvdmlkZXJ9IHRvIGNhbGN1bGF0ZSBpdHMgYm91bmRpbmcgYm94LiBUaGUgb2JqZWN0IGlzIGF1dG9tYXRpY2FsbHkgYWRkZWQgdG8gdGhlIHNjZW5lLlxuICpcbiAqIFRoZSBzY2VuZSdzIHtAbGluayBHYW1lT2JqZWN0Q3JlYXRvcn0gKGBTY2VuZS5tYWtlYCkgZ2V0cyB0aGVzZSBhZGRpdGlvbmFsIGZ1bmN0aW9uczpcbiAqICogYHNwaW5lKGNvbmZpZzogU3BpbmVHYW1lT2JqZWN0Q29uZmlnKWA6IGNyZWF0ZXMgYSBuZXcge0BsaW5rIFNwaW5lR2FtZU9iamVjdH0gZnJvbSB0aGUgZ2l2ZW4gY29uZmlndXJhdGlvbiBvYmplY3QuXG4gKlxuICogVGhlIHBsdWdpbiBoYXMgYWRkaXRpb25hbCBwdWJsaWMgbWV0aG9kcyB0byB3b3JrIHdpdGggU3BpbmUgUnVudGltZSBjb3JlIEFQSSBvYmplY3RzOlxuICogKiBgZ2V0QXRsYXMoYXRsYXNLZXk6IHN0cmluZylgOiByZXR1cm5zIHRoZSB7QGxpbmsgVGV4dHVyZUF0bGFzfSBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIGF0bGFzIGtleS5cbiAqICogYGdldFNrZWxldG9uRGF0YShza2VsZXRvbkRhdGFLZXk6IHN0cmluZylgOiByZXR1cm5zIHRoZSB7QGxpbmsgU2tlbGV0b25EYXRhfSBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIHNrZWxldG9uIGRhdGEga2V5LlxuICogKiBgY3JlYXRlU2tlbGV0b24oc2tlbGV0b25EYXRhS2V5OiBzdHJpbmcsIGF0bGFzS2V5OiBzdHJpbmcsIHByZW11bHRpcGxpZWRBbHBoYTogYm9vbGVhbiA9IHRydWUpYDogY3JlYXRlcyBhIG5ldyB7QGxpbmsgU2tlbGV0b259IGluc3RhbmNlIGZyb20gdGhlIGdpdmVuIHNrZWxldG9uIGRhdGEgYW5kIGF0bGFzIGtleS5cbiAqICogYGlzUHJlbXVsdGlwbGllZEFscGhhKGF0bGFzS2V5OiBzdHJpbmcpYDogcmV0dXJucyBgdHJ1ZWAgaWYgdGhlIGF0bGFzIHdpdGggdGhlIGdpdmVuIGtleSBoYXMgcHJlbXVsdGlwbGllZCBhbHBoYS5cbiAqL1xuZXhwb3J0IGNsYXNzIFNwaW5lUGx1Z2luIGV4dGVuZHMgUGhhc2VyLlBsdWdpbnMuU2NlbmVQbHVnaW4ge1xuXHRnYW1lOiBQaGFzZXIuR2FtZTtcblx0cHJpdmF0ZSBpc1dlYkdMOiBib29sZWFuO1xuXHRnbDogV2ViR0xSZW5kZXJpbmdDb250ZXh0IHwgbnVsbDtcblx0c3RhdGljIGdhbWVXZWJHTFJlbmRlcmVyOiBTY2VuZVJlbmRlcmVyIHwgbnVsbCA9IG51bGw7XG5cdGdldCB3ZWJHTFJlbmRlcmVyICgpOiBTY2VuZVJlbmRlcmVyIHwgbnVsbCB7XG5cdFx0cmV0dXJuIFNwaW5lUGx1Z2luLmdhbWVXZWJHTFJlbmRlcmVyO1xuXHR9XG5cdGNhbnZhc1JlbmRlcmVyOiBTa2VsZXRvblJlbmRlcmVyIHwgbnVsbDtcblx0cGhhc2VyUmVuZGVyZXI6IFBoYXNlci5SZW5kZXJlci5DYW52YXMuQ2FudmFzUmVuZGVyZXIgfCBQaGFzZXIuUmVuZGVyZXIuV2ViR0wuV2ViR0xSZW5kZXJlcjtcblx0cHJpdmF0ZSBza2VsZXRvbkRhdGFDYWNoZTogUGhhc2VyLkNhY2hlLkJhc2VDYWNoZTtcblx0cHJpdmF0ZSBhdGxhc0NhY2hlOiBQaGFzZXIuQ2FjaGUuQmFzZUNhY2hlO1xuXG5cdGNvbnN0cnVjdG9yIChzY2VuZTogUGhhc2VyLlNjZW5lLCBwbHVnaW5NYW5hZ2VyOiBQaGFzZXIuUGx1Z2lucy5QbHVnaW5NYW5hZ2VyLCBwbHVnaW5LZXk6IHN0cmluZykge1xuXHRcdHN1cGVyKHNjZW5lLCBwbHVnaW5NYW5hZ2VyLCBwbHVnaW5LZXkpO1xuXHRcdHRoaXMuZ2FtZSA9IHBsdWdpbk1hbmFnZXIuZ2FtZTtcblx0XHR0aGlzLmlzV2ViR0wgPSB0aGlzLmdhbWUuY29uZmlnLnJlbmRlclR5cGUgPT09IDI7XG5cdFx0dGhpcy5nbCA9IHRoaXMuaXNXZWJHTCA/ICh0aGlzLmdhbWUucmVuZGVyZXIgYXMgUGhhc2VyLlJlbmRlcmVyLldlYkdMLldlYkdMUmVuZGVyZXIpLmdsIDogbnVsbDtcblx0XHR0aGlzLnBoYXNlclJlbmRlcmVyID0gdGhpcy5nYW1lLnJlbmRlcmVyO1xuXHRcdHRoaXMuY2FudmFzUmVuZGVyZXIgPSBudWxsO1xuXHRcdHRoaXMuc2tlbGV0b25EYXRhQ2FjaGUgPSB0aGlzLmdhbWUuY2FjaGUuYWRkQ3VzdG9tKFNQSU5FX1NLRUxFVE9OX0RBVEFfQ0FDSEVfS0VZKTtcblx0XHR0aGlzLmF0bGFzQ2FjaGUgPSB0aGlzLmdhbWUuY2FjaGUuYWRkQ3VzdG9tKFNQSU5FX0FUTEFTX0NBQ0hFX0tFWSk7XG5cblx0XHRsZXQgc2tlbGV0b25Kc29uRmlsZUNhbGxiYWNrID0gZnVuY3Rpb24gKHRoaXM6IGFueSwga2V5OiBzdHJpbmcsXG5cdFx0XHR1cmw6IHN0cmluZyxcblx0XHRcdHhoclNldHRpbmdzOiBQaGFzZXIuVHlwZXMuTG9hZGVyLlhIUlNldHRpbmdzT2JqZWN0KSB7XG5cdFx0XHRsZXQgZmlsZSA9IG5ldyBTcGluZVNrZWxldG9uRGF0YUZpbGUodGhpcyBhcyBhbnksIGtleSwgdXJsLCBTcGluZVNrZWxldG9uRGF0YUZpbGVUeXBlLmpzb24sIHhoclNldHRpbmdzKTtcblx0XHRcdHRoaXMuYWRkRmlsZShmaWxlLmZpbGVzKTtcblx0XHRcdHJldHVybiB0aGlzO1xuXHRcdH07XG5cdFx0cGx1Z2luTWFuYWdlci5yZWdpc3RlckZpbGVUeXBlKFwic3BpbmVKc29uXCIsIHNrZWxldG9uSnNvbkZpbGVDYWxsYmFjaywgc2NlbmUpO1xuXG5cdFx0bGV0IHNrZWxldG9uQmluYXJ5RmlsZUNhbGxiYWNrID0gZnVuY3Rpb24gKHRoaXM6IGFueSwga2V5OiBzdHJpbmcsXG5cdFx0XHR1cmw6IHN0cmluZyxcblx0XHRcdHhoclNldHRpbmdzOiBQaGFzZXIuVHlwZXMuTG9hZGVyLlhIUlNldHRpbmdzT2JqZWN0KSB7XG5cdFx0XHRsZXQgZmlsZSA9IG5ldyBTcGluZVNrZWxldG9uRGF0YUZpbGUodGhpcyBhcyBhbnksIGtleSwgdXJsLCBTcGluZVNrZWxldG9uRGF0YUZpbGVUeXBlLmJpbmFyeSwgeGhyU2V0dGluZ3MpO1xuXHRcdFx0dGhpcy5hZGRGaWxlKGZpbGUuZmlsZXMpO1xuXHRcdFx0cmV0dXJuIHRoaXM7XG5cdFx0fTtcblx0XHRwbHVnaW5NYW5hZ2VyLnJlZ2lzdGVyRmlsZVR5cGUoXCJzcGluZUJpbmFyeVwiLCBza2VsZXRvbkJpbmFyeUZpbGVDYWxsYmFjaywgc2NlbmUpO1xuXG5cdFx0bGV0IGF0bGFzRmlsZUNhbGxiYWNrID0gZnVuY3Rpb24gKHRoaXM6IGFueSwga2V5OiBzdHJpbmcsXG5cdFx0XHR1cmw6IHN0cmluZyxcblx0XHRcdHByZW11bHRpcGxpZWRBbHBoYTogYm9vbGVhbixcblx0XHRcdHhoclNldHRpbmdzOiBQaGFzZXIuVHlwZXMuTG9hZGVyLlhIUlNldHRpbmdzT2JqZWN0KSB7XG5cdFx0XHRsZXQgZmlsZSA9IG5ldyBTcGluZUF0bGFzRmlsZSh0aGlzIGFzIGFueSwga2V5LCB1cmwsIHByZW11bHRpcGxpZWRBbHBoYSwgeGhyU2V0dGluZ3MpO1xuXHRcdFx0dGhpcy5hZGRGaWxlKGZpbGUuZmlsZXMpO1xuXHRcdFx0cmV0dXJuIHRoaXM7XG5cdFx0fTtcblx0XHRwbHVnaW5NYW5hZ2VyLnJlZ2lzdGVyRmlsZVR5cGUoXCJzcGluZUF0bGFzXCIsIGF0bGFzRmlsZUNhbGxiYWNrLCBzY2VuZSk7XG5cblx0XHRsZXQgYWRkU3BpbmVHYW1lT2JqZWN0ID0gZnVuY3Rpb24gKHRoaXM6IFBoYXNlci5HYW1lT2JqZWN0cy5HYW1lT2JqZWN0RmFjdG9yeSwgeDogbnVtYmVyLCB5OiBudW1iZXIsIGRhdGFLZXk6IHN0cmluZywgYXRsYXNLZXk6IHN0cmluZywgYm91bmRzUHJvdmlkZXI6IFNwaW5lR2FtZU9iamVjdEJvdW5kc1Byb3ZpZGVyKSB7XG5cdFx0XHRpZiAodGhpcy5zY2VuZS5zeXMucmVuZGVyZXIgaW5zdGFuY2VvZiBQaGFzZXIuUmVuZGVyZXIuV2ViR0wuV2ViR0xSZW5kZXJlcikge1xuXHRcdFx0XHR0aGlzLnNjZW5lLnN5cy5yZW5kZXJlci5waXBlbGluZXMuY2xlYXIoKTtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3Qgc3BpbmVQbHVnaW4gPSAodGhpcy5zY2VuZS5zeXMgYXMgYW55KVtwbHVnaW5LZXldIGFzIFNwaW5lUGx1Z2luO1xuXHRcdFx0bGV0IGdhbWVPYmplY3QgPSBuZXcgU3BpbmVHYW1lT2JqZWN0KHRoaXMuc2NlbmUsIHNwaW5lUGx1Z2luLCB4LCB5LCBkYXRhS2V5LCBhdGxhc0tleSwgYm91bmRzUHJvdmlkZXIpO1xuXHRcdFx0dGhpcy5kaXNwbGF5TGlzdC5hZGQoZ2FtZU9iamVjdCk7XG5cdFx0XHR0aGlzLnVwZGF0ZUxpc3QuYWRkKGdhbWVPYmplY3QpO1xuXG5cdFx0XHRpZiAodGhpcy5zY2VuZS5zeXMucmVuZGVyZXIgaW5zdGFuY2VvZiBQaGFzZXIuUmVuZGVyZXIuV2ViR0wuV2ViR0xSZW5kZXJlcikge1xuXHRcdFx0XHR0aGlzLnNjZW5lLnN5cy5yZW5kZXJlci5waXBlbGluZXMucmViaW5kKCk7XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBnYW1lT2JqZWN0O1xuXHRcdH07XG5cblx0XHRsZXQgbWFrZVNwaW5lR2FtZU9iamVjdCA9IGZ1bmN0aW9uICh0aGlzOiBQaGFzZXIuR2FtZU9iamVjdHMuR2FtZU9iamVjdEZhY3RvcnksIGNvbmZpZzogU3BpbmVHYW1lT2JqZWN0Q29uZmlnLCBhZGRUb1NjZW5lOiBib29sZWFuID0gZmFsc2UpIHtcblx0XHRcdGlmICh0aGlzLnNjZW5lLnN5cy5yZW5kZXJlciBpbnN0YW5jZW9mIFBoYXNlci5SZW5kZXJlci5XZWJHTC5XZWJHTFJlbmRlcmVyKSB7XG5cdFx0XHRcdHRoaXMuc2NlbmUuc3lzLnJlbmRlcmVyLnBpcGVsaW5lcy5jbGVhcigpO1xuXHRcdFx0fVxuXG5cdFx0XHRsZXQgeCA9IGNvbmZpZy54ID8gY29uZmlnLnggOiAwO1xuXHRcdFx0bGV0IHkgPSBjb25maWcueSA/IGNvbmZpZy55IDogMDtcblx0XHRcdGxldCBib3VuZHNQcm92aWRlciA9IGNvbmZpZy5ib3VuZHNQcm92aWRlciA/IGNvbmZpZy5ib3VuZHNQcm92aWRlciA6IHVuZGVmaW5lZDtcblxuXHRcdFx0Y29uc3Qgc3BpbmVQbHVnaW4gPSAodGhpcy5zY2VuZS5zeXMgYXMgYW55KVtwbHVnaW5LZXldIGFzIFNwaW5lUGx1Z2luO1xuXHRcdFx0bGV0IGdhbWVPYmplY3QgPSBuZXcgU3BpbmVHYW1lT2JqZWN0KHRoaXMuc2NlbmUsIHNwaW5lUGx1Z2luLCB4LCB5LCBjb25maWcuZGF0YUtleSwgY29uZmlnLmF0bGFzS2V5LCBib3VuZHNQcm92aWRlcik7XG5cdFx0XHRpZiAoYWRkVG9TY2VuZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHRcdGNvbmZpZy5hZGQgPSBhZGRUb1NjZW5lO1xuXHRcdFx0fVxuXG5cdFx0XHRpZiAodGhpcy5zY2VuZS5zeXMucmVuZGVyZXIgaW5zdGFuY2VvZiBQaGFzZXIuUmVuZGVyZXIuV2ViR0wuV2ViR0xSZW5kZXJlcikge1xuXHRcdFx0XHR0aGlzLnNjZW5lLnN5cy5yZW5kZXJlci5waXBlbGluZXMucmViaW5kKCk7XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBQaGFzZXIuR2FtZU9iamVjdHMuQnVpbGRHYW1lT2JqZWN0KHRoaXMuc2NlbmUsIGdhbWVPYmplY3QsIGNvbmZpZyk7XG5cdFx0fVxuXHRcdHBsdWdpbk1hbmFnZXIucmVnaXN0ZXJHYW1lT2JqZWN0KCh3aW5kb3cgYXMgYW55KS5TUElORV9HQU1FX09CSkVDVF9UWVBFID8gKHdpbmRvdyBhcyBhbnkpLlNQSU5FX0dBTUVfT0JKRUNUX1RZUEUgOiBTUElORV9HQU1FX09CSkVDVF9UWVBFLCBhZGRTcGluZUdhbWVPYmplY3QsIG1ha2VTcGluZUdhbWVPYmplY3QpO1xuXHR9XG5cblx0c3RhdGljIHJlbmRlcmVySWQgPSAwO1xuXHRib290ICgpIHtcblx0XHRTa2VsZXRvbi55RG93biA9IHRydWU7XG5cdFx0aWYgKHRoaXMuaXNXZWJHTCkge1xuXHRcdFx0aWYgKCFTcGluZVBsdWdpbi5nYW1lV2ViR0xSZW5kZXJlcikge1xuXHRcdFx0XHRTcGluZVBsdWdpbi5nYW1lV2ViR0xSZW5kZXJlciA9IG5ldyBTY2VuZVJlbmRlcmVyKCh0aGlzLmdhbWUucmVuZGVyZXIhIGFzIFBoYXNlci5SZW5kZXJlci5XZWJHTC5XZWJHTFJlbmRlcmVyKS5jYW52YXMsIHRoaXMuZ2whLCB0cnVlKTtcblx0XHRcdH1cblx0XHRcdHRoaXMub25SZXNpemUoKTtcblx0XHRcdHRoaXMuZ2FtZS5zY2FsZS5vbihQaGFzZXIuU2NhbGUuRXZlbnRzLlJFU0laRSwgdGhpcy5vblJlc2l6ZSwgdGhpcyk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGlmICghdGhpcy5jYW52YXNSZW5kZXJlcikge1xuXHRcdFx0XHR0aGlzLmNhbnZhc1JlbmRlcmVyID0gbmV3IFNrZWxldG9uUmVuZGVyZXIodGhpcy5zY2VuZSEuc3lzLmNvbnRleHQpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHZhciBldmVudEVtaXR0ZXIgPSB0aGlzLnN5c3RlbXMhLmV2ZW50cztcblx0XHRldmVudEVtaXR0ZXIub25jZSgnc2h1dGRvd24nLCB0aGlzLnNodXRkb3duLCB0aGlzKTtcblx0XHRldmVudEVtaXR0ZXIub25jZSgnZGVzdHJveScsIHRoaXMuZGVzdHJveSwgdGhpcyk7XG5cdFx0dGhpcy5nYW1lLmV2ZW50cy5vbmNlKCdkZXN0cm95JywgdGhpcy5nYW1lRGVzdHJveSwgdGhpcyk7XG5cdH1cblxuXHRvblJlc2l6ZSAoKSB7XG5cdFx0dmFyIHBoYXNlclJlbmRlcmVyID0gdGhpcy5nYW1lLnJlbmRlcmVyO1xuXHRcdHZhciBzY2VuZVJlbmRlcmVyID0gdGhpcy53ZWJHTFJlbmRlcmVyO1xuXG5cdFx0aWYgKHBoYXNlclJlbmRlcmVyICYmIHNjZW5lUmVuZGVyZXIpIHtcblx0XHRcdHZhciB2aWV3cG9ydFdpZHRoID0gcGhhc2VyUmVuZGVyZXIud2lkdGg7XG5cdFx0XHR2YXIgdmlld3BvcnRIZWlnaHQgPSBwaGFzZXJSZW5kZXJlci5oZWlnaHQ7XG5cdFx0XHRzY2VuZVJlbmRlcmVyLmNhbWVyYS5wb3NpdGlvbi54ID0gdmlld3BvcnRXaWR0aCAvIDI7XG5cdFx0XHRzY2VuZVJlbmRlcmVyLmNhbWVyYS5wb3NpdGlvbi55ID0gdmlld3BvcnRIZWlnaHQgLyAyO1xuXHRcdFx0c2NlbmVSZW5kZXJlci5jYW1lcmEudXAueSA9IC0xO1xuXHRcdFx0c2NlbmVSZW5kZXJlci5jYW1lcmEuZGlyZWN0aW9uLnogPSAxO1xuXHRcdFx0c2NlbmVSZW5kZXJlci5jYW1lcmEuc2V0Vmlld3BvcnQodmlld3BvcnRXaWR0aCwgdmlld3BvcnRIZWlnaHQpO1xuXHRcdH1cblx0fVxuXG5cdHNodXRkb3duICgpIHtcblx0XHR0aGlzLnN5c3RlbXMhLmV2ZW50cy5vZmYoXCJzaHV0ZG93blwiLCB0aGlzLnNodXRkb3duLCB0aGlzKTtcblx0XHRpZiAodGhpcy5pc1dlYkdMKSB7XG5cdFx0XHR0aGlzLmdhbWUuc2NhbGUub2ZmKFBoYXNlci5TY2FsZS5FdmVudHMuUkVTSVpFLCB0aGlzLm9uUmVzaXplLCB0aGlzKTtcblx0XHR9XG5cdH1cblxuXHRkZXN0cm95ICgpIHtcblx0XHR0aGlzLnNodXRkb3duKClcblx0fVxuXG5cdGdhbWVEZXN0cm95ICgpIHtcblx0XHR0aGlzLnBsdWdpbk1hbmFnZXIucmVtb3ZlR2FtZU9iamVjdCgod2luZG93IGFzIGFueSkuU1BJTkVfR0FNRV9PQkpFQ1RfVFlQRSA/ICh3aW5kb3cgYXMgYW55KS5TUElORV9HQU1FX09CSkVDVF9UWVBFIDogU1BJTkVfR0FNRV9PQkpFQ1RfVFlQRSwgdHJ1ZSwgdHJ1ZSk7XG5cdFx0aWYgKHRoaXMud2ViR0xSZW5kZXJlcikgdGhpcy53ZWJHTFJlbmRlcmVyLmRpc3Bvc2UoKTtcblx0XHRTcGluZVBsdWdpbi5nYW1lV2ViR0xSZW5kZXJlciA9IG51bGw7XG5cdH1cblxuXHQvKiogUmV0dXJucyB0aGUgVGV4dHVyZUF0bGFzIGluc3RhbmNlIGZvciB0aGUgZ2l2ZW4ga2V5ICovXG5cdGdldEF0bGFzIChhdGxhc0tleTogc3RyaW5nKSB7XG5cdFx0bGV0IGF0bGFzOiBUZXh0dXJlQXRsYXM7XG5cdFx0aWYgKHRoaXMuYXRsYXNDYWNoZS5leGlzdHMoYXRsYXNLZXkpKSB7XG5cdFx0XHRhdGxhcyA9IHRoaXMuYXRsYXNDYWNoZS5nZXQoYXRsYXNLZXkpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRsZXQgYXRsYXNGaWxlID0gdGhpcy5nYW1lLmNhY2hlLnRleHQuZ2V0KGF0bGFzS2V5KSBhcyB7IGRhdGE6IHN0cmluZywgcHJlbXVsdGlwbGllZEFscGhhOiBib29sZWFuIH07XG5cdFx0XHRhdGxhcyA9IG5ldyBUZXh0dXJlQXRsYXMoYXRsYXNGaWxlLmRhdGEpO1xuXHRcdFx0aWYgKHRoaXMuaXNXZWJHTCkge1xuXHRcdFx0XHRsZXQgZ2wgPSB0aGlzLmdsITtcblx0XHRcdFx0Y29uc3QgcGhhc2VyVW5wYWNrUG1hVmFsdWUgPSBnbC5nZXRQYXJhbWV0ZXIoZ2wuVU5QQUNLX1BSRU1VTFRJUExZX0FMUEhBX1dFQkdMKTtcblx0XHRcdFx0aWYgKHBoYXNlclVucGFja1BtYVZhbHVlKSBnbC5waXhlbFN0b3JlaShnbC5VTlBBQ0tfUFJFTVVMVElQTFlfQUxQSEFfV0VCR0wsIGZhbHNlKTtcblx0XHRcdFx0Zm9yIChsZXQgYXRsYXNQYWdlIG9mIGF0bGFzLnBhZ2VzKSB7XG5cdFx0XHRcdFx0YXRsYXNQYWdlLnNldFRleHR1cmUobmV3IEdMVGV4dHVyZShnbCwgdGhpcy5nYW1lLnRleHR1cmVzLmdldChhdGxhc0tleSArIFwiIVwiICsgYXRsYXNQYWdlLm5hbWUpLmdldFNvdXJjZUltYWdlKCkgYXMgSFRNTEltYWdlRWxlbWVudCB8IEltYWdlQml0bWFwLCBmYWxzZSkpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGlmIChwaGFzZXJVbnBhY2tQbWFWYWx1ZSkgZ2wucGl4ZWxTdG9yZWkoZ2wuVU5QQUNLX1BSRU1VTFRJUExZX0FMUEhBX1dFQkdMLCB0cnVlKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGZvciAobGV0IGF0bGFzUGFnZSBvZiBhdGxhcy5wYWdlcykge1xuXHRcdFx0XHRcdGF0bGFzUGFnZS5zZXRUZXh0dXJlKG5ldyBDYW52YXNUZXh0dXJlKHRoaXMuZ2FtZS50ZXh0dXJlcy5nZXQoYXRsYXNLZXkgKyBcIiFcIiArIGF0bGFzUGFnZS5uYW1lKS5nZXRTb3VyY2VJbWFnZSgpIGFzIEhUTUxJbWFnZUVsZW1lbnQgfCBJbWFnZUJpdG1hcCkpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHR0aGlzLmF0bGFzQ2FjaGUuYWRkKGF0bGFzS2V5LCBhdGxhcyk7XG5cdFx0fVxuXHRcdHJldHVybiBhdGxhcztcblx0fVxuXG5cdC8qKiBSZXR1cm5zIHdoZXRoZXIgdGhlIFRleHR1cmVBdGxhcyB1c2VzIHByZW11bHRpcGxpZWQgYWxwaGEgKi9cblx0aXNBdGxhc1ByZW11bHRpcGxpZWQgKGF0bGFzS2V5OiBzdHJpbmcpIHtcblx0XHRsZXQgYXRsYXNGaWxlID0gdGhpcy5nYW1lLmNhY2hlLnRleHQuZ2V0KGF0bGFzS2V5KTtcblx0XHRpZiAoIWF0bGFzRmlsZSkgcmV0dXJuIGZhbHNlO1xuXHRcdHJldHVybiBhdGxhc0ZpbGUucHJlbXVsdGlwbGllZEFscGhhO1xuXHR9XG5cblx0LyoqIFJldHVybnMgdGhlIFNrZWxldG9uRGF0YSBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIGRhdGEgYW5kIGF0bGFzIGtleSAqL1xuXHRnZXRTa2VsZXRvbkRhdGEgKGRhdGFLZXk6IHN0cmluZywgYXRsYXNLZXk6IHN0cmluZykge1xuXHRcdGNvbnN0IGF0bGFzID0gdGhpcy5nZXRBdGxhcyhhdGxhc0tleSlcblx0XHRjb25zdCBjb21iaW5lZEtleSA9IGRhdGFLZXkgKyBhdGxhc0tleTtcblx0XHRsZXQgc2tlbGV0b25EYXRhOiBTa2VsZXRvbkRhdGE7XG5cdFx0aWYgKHRoaXMuc2tlbGV0b25EYXRhQ2FjaGUuZXhpc3RzKGNvbWJpbmVkS2V5KSkge1xuXHRcdFx0c2tlbGV0b25EYXRhID0gdGhpcy5za2VsZXRvbkRhdGFDYWNoZS5nZXQoY29tYmluZWRLZXkpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRpZiAodGhpcy5nYW1lLmNhY2hlLmpzb24uZXhpc3RzKGRhdGFLZXkpKSB7XG5cdFx0XHRcdGxldCBqc29uRmlsZSA9IHRoaXMuZ2FtZS5jYWNoZS5qc29uLmdldChkYXRhS2V5KSBhcyBhbnk7XG5cdFx0XHRcdGxldCBqc29uID0gbmV3IFNrZWxldG9uSnNvbihuZXcgQXRsYXNBdHRhY2htZW50TG9hZGVyKGF0bGFzKSk7XG5cdFx0XHRcdHNrZWxldG9uRGF0YSA9IGpzb24ucmVhZFNrZWxldG9uRGF0YShqc29uRmlsZSk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRsZXQgYmluYXJ5RmlsZSA9IHRoaXMuZ2FtZS5jYWNoZS5iaW5hcnkuZ2V0KGRhdGFLZXkpIGFzIEFycmF5QnVmZmVyO1xuXHRcdFx0XHRsZXQgYmluYXJ5ID0gbmV3IFNrZWxldG9uQmluYXJ5KG5ldyBBdGxhc0F0dGFjaG1lbnRMb2FkZXIoYXRsYXMpKTtcblx0XHRcdFx0c2tlbGV0b25EYXRhID0gYmluYXJ5LnJlYWRTa2VsZXRvbkRhdGEobmV3IFVpbnQ4QXJyYXkoYmluYXJ5RmlsZSkpO1xuXHRcdFx0fVxuXHRcdFx0dGhpcy5za2VsZXRvbkRhdGFDYWNoZS5hZGQoY29tYmluZWRLZXksIHNrZWxldG9uRGF0YSk7XG5cdFx0fVxuXHRcdHJldHVybiBza2VsZXRvbkRhdGE7XG5cdH1cblxuXHQvKiogQ3JlYXRlcyBhIG5ldyBTa2VsZXRvbiBpbnN0YW5jZSBmcm9tIHRoZSBkYXRhIGFuZCBhdGxhcy4gKi9cblx0Y3JlYXRlU2tlbGV0b24gKGRhdGFLZXk6IHN0cmluZywgYXRsYXNLZXk6IHN0cmluZykge1xuXHRcdHJldHVybiBuZXcgU2tlbGV0b24odGhpcy5nZXRTa2VsZXRvbkRhdGEoZGF0YUtleSwgYXRsYXNLZXkpKTtcblx0fVxufVxuXG5lbnVtIFNwaW5lU2tlbGV0b25EYXRhRmlsZVR5cGUge1xuXHRqc29uLFxuXHRiaW5hcnlcbn1cblxuaW50ZXJmYWNlIFNwaW5lU2tlbGV0b25EYXRhRmlsZUNvbmZpZyB7XG5cdGtleTogc3RyaW5nO1xuXHR1cmw6IHN0cmluZztcblx0dHlwZTogXCJzcGluZUpzb25cIiB8IFwic3BpbmVCaW5hcnlcIjtcblx0eGhyU2V0dGluZ3M/OiBQaGFzZXIuVHlwZXMuTG9hZGVyLlhIUlNldHRpbmdzT2JqZWN0XG59XG5cbmNsYXNzIFNwaW5lU2tlbGV0b25EYXRhRmlsZSBleHRlbmRzIFBoYXNlci5Mb2FkZXIuTXVsdGlGaWxlIHtcblx0Y29uc3RydWN0b3IgKGxvYWRlcjogUGhhc2VyLkxvYWRlci5Mb2FkZXJQbHVnaW4sIGtleTogc3RyaW5nIHwgU3BpbmVTa2VsZXRvbkRhdGFGaWxlQ29uZmlnLCB1cmw/OiBzdHJpbmcsIHB1YmxpYyBmaWxlVHlwZT86IFNwaW5lU2tlbGV0b25EYXRhRmlsZVR5cGUsIHhoclNldHRpbmdzPzogUGhhc2VyLlR5cGVzLkxvYWRlci5YSFJTZXR0aW5nc09iamVjdCkge1xuXHRcdGlmICh0eXBlb2Yga2V5ICE9PSBcInN0cmluZ1wiKSB7XG5cdFx0XHRjb25zdCBjb25maWcgPSBrZXk7XG5cdFx0XHRrZXkgPSBjb25maWcua2V5O1xuXHRcdFx0dXJsID0gY29uZmlnLnVybDtcblx0XHRcdGZpbGVUeXBlID0gY29uZmlnLnR5cGUgPT09IFwic3BpbmVKc29uXCIgPyBTcGluZVNrZWxldG9uRGF0YUZpbGVUeXBlLmpzb24gOiBTcGluZVNrZWxldG9uRGF0YUZpbGVUeXBlLmJpbmFyeTtcblx0XHRcdHhoclNldHRpbmdzID0gY29uZmlnLnhoclNldHRpbmdzO1xuXHRcdH1cblx0XHRsZXQgZmlsZSA9IG51bGw7XG5cdFx0bGV0IGlzSnNvbiA9IGZpbGVUeXBlID09IFNwaW5lU2tlbGV0b25EYXRhRmlsZVR5cGUuanNvbjtcblx0XHRpZiAoaXNKc29uKSB7XG5cdFx0XHRmaWxlID0gbmV3IFBoYXNlci5Mb2FkZXIuRmlsZVR5cGVzLkpTT05GaWxlKGxvYWRlciwge1xuXHRcdFx0XHRrZXk6IGtleSxcblx0XHRcdFx0dXJsOiB1cmwsXG5cdFx0XHRcdGV4dGVuc2lvbjogXCJqc29uXCIsXG5cdFx0XHRcdHhoclNldHRpbmdzOiB4aHJTZXR0aW5ncyxcblx0XHRcdH0gYXMgUGhhc2VyLlR5cGVzLkxvYWRlci5GaWxlVHlwZXMuSlNPTkZpbGVDb25maWcpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRmaWxlID0gbmV3IFBoYXNlci5Mb2FkZXIuRmlsZVR5cGVzLkJpbmFyeUZpbGUobG9hZGVyLCB7XG5cdFx0XHRcdGtleToga2V5LFxuXHRcdFx0XHR1cmw6IHVybCxcblx0XHRcdFx0ZXh0ZW5zaW9uOiBcInNrZWxcIixcblx0XHRcdFx0eGhyU2V0dGluZ3M6IHhoclNldHRpbmdzLFxuXHRcdFx0fSBhcyBQaGFzZXIuVHlwZXMuTG9hZGVyLkZpbGVUeXBlcy5CaW5hcnlGaWxlQ29uZmlnKTtcblx0XHR9XG5cdFx0c3VwZXIobG9hZGVyLCBTUElORV9TS0VMRVRPTl9EQVRBX0ZJTEVfVFlQRSwga2V5LCBbZmlsZV0pO1xuXHR9XG5cblx0b25GaWxlQ29tcGxldGUgKGZpbGU6IFBoYXNlci5Mb2FkZXIuRmlsZSkge1xuXHRcdHRoaXMucGVuZGluZy0tO1xuXHR9XG5cblx0YWRkVG9DYWNoZSAoKSB7XG5cdFx0aWYgKHRoaXMuaXNSZWFkeVRvUHJvY2VzcygpKSB0aGlzLmZpbGVzWzBdLmFkZFRvQ2FjaGUoKTtcblx0fVxufVxuXG5pbnRlcmZhY2UgU3BpbmVBdGxhc0ZpbGVDb25maWcge1xuXHRrZXk6IHN0cmluZztcblx0dXJsOiBzdHJpbmc7XG5cdHByZW11bHRpcGxpZWRBbHBoYT86IGJvb2xlYW47XG5cdHhoclNldHRpbmdzPzogUGhhc2VyLlR5cGVzLkxvYWRlci5YSFJTZXR0aW5nc09iamVjdDtcbn1cblxuY2xhc3MgU3BpbmVBdGxhc0ZpbGUgZXh0ZW5kcyBQaGFzZXIuTG9hZGVyLk11bHRpRmlsZSB7XG5cdGNvbnN0cnVjdG9yIChsb2FkZXI6IFBoYXNlci5Mb2FkZXIuTG9hZGVyUGx1Z2luLCBrZXk6IHN0cmluZyB8IFNwaW5lQXRsYXNGaWxlQ29uZmlnLCB1cmw/OiBzdHJpbmcsIHB1YmxpYyBwcmVtdWx0aXBsaWVkQWxwaGE/OiBib29sZWFuLCB4aHJTZXR0aW5ncz86IFBoYXNlci5UeXBlcy5Mb2FkZXIuWEhSU2V0dGluZ3NPYmplY3QpIHtcblx0XHRpZiAodHlwZW9mIGtleSAhPT0gXCJzdHJpbmdcIikge1xuXHRcdFx0Y29uc3QgY29uZmlnID0ga2V5O1xuXHRcdFx0a2V5ID0gY29uZmlnLmtleTtcblx0XHRcdHVybCA9IGNvbmZpZy51cmw7XG5cdFx0XHRwcmVtdWx0aXBsaWVkQWxwaGEgPSBjb25maWcucHJlbXVsdGlwbGllZEFscGhhO1xuXHRcdFx0eGhyU2V0dGluZ3MgPSBjb25maWcueGhyU2V0dGluZ3M7XG5cdFx0fVxuXG5cdFx0c3VwZXIobG9hZGVyLCBTUElORV9BVExBU19GSUxFX1RZUEUsIGtleSwgW1xuXHRcdFx0bmV3IFBoYXNlci5Mb2FkZXIuRmlsZVR5cGVzLlRleHRGaWxlKGxvYWRlciwge1xuXHRcdFx0XHRrZXk6IGtleSxcblx0XHRcdFx0dXJsOiB1cmwsXG5cdFx0XHRcdHhoclNldHRpbmdzOiB4aHJTZXR0aW5ncyxcblx0XHRcdFx0ZXh0ZW5zaW9uOiBcImF0bGFzXCJcblx0XHRcdH0pXG5cdFx0XSk7XG5cdH1cblxuXHRvbkZpbGVDb21wbGV0ZSAoZmlsZTogUGhhc2VyLkxvYWRlci5GaWxlKSB7XG5cdFx0aWYgKHRoaXMuZmlsZXMuaW5kZXhPZihmaWxlKSAhPSAtMSkge1xuXHRcdFx0dGhpcy5wZW5kaW5nLS07XG5cblx0XHRcdGlmIChmaWxlLnR5cGUgPT0gXCJ0ZXh0XCIpIHtcblx0XHRcdFx0dmFyIGxpbmVzID0gZmlsZS5kYXRhLnNwbGl0KC9cXHJcXG58XFxyfFxcbi8pO1xuXHRcdFx0XHRsZXQgdGV4dHVyZXMgPSBbXTtcblx0XHRcdFx0dGV4dHVyZXMucHVzaChsaW5lc1swXSk7XG5cdFx0XHRcdGZvciAodmFyIHQgPSAxOyB0IDwgbGluZXMubGVuZ3RoOyB0KyspIHtcblx0XHRcdFx0XHR2YXIgbGluZSA9IGxpbmVzW3RdO1xuXHRcdFx0XHRcdGlmIChsaW5lLnRyaW0oKSA9PT0gJycgJiYgdCA8IGxpbmVzLmxlbmd0aCAtIDEpIHtcblx0XHRcdFx0XHRcdGxpbmUgPSBsaW5lc1t0ICsgMV07XG5cdFx0XHRcdFx0XHR0ZXh0dXJlcy5wdXNoKGxpbmUpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHRcdGxldCBiYXNlUGF0aCA9IGZpbGUuc3JjLm1hdGNoKC9eLipcXC8vKSA/PyBcIlwiO1xuXHRcdFx0XHRpZih0aGlzLmxvYWRlci5wYXRoICYmIHRoaXMubG9hZGVyLnBhdGgubGVuZ3RoID4gMCAmJiBiYXNlUGF0aC50b1N0cmluZygpLnN0YXJ0c1dpdGgodGhpcy5sb2FkZXIucGF0aCkpIHtcblx0XHRcdFx0XHRiYXNlUGF0aCA9IGJhc2VQYXRoLnRvU3RyaW5nKCkuc2xpY2UodGhpcy5sb2FkZXIucGF0aC5sZW5ndGgpO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0Zm9yICh2YXIgaSA9IDA7IGkgPCB0ZXh0dXJlcy5sZW5ndGg7IGkrKykge1xuXHRcdFx0XHRcdHZhciB1cmwgPSBiYXNlUGF0aCArIHRleHR1cmVzW2ldO1xuXHRcdFx0XHRcdHZhciBrZXkgPSBmaWxlLmtleSArIFwiIVwiICsgdGV4dHVyZXNbaV07XG5cdFx0XHRcdFx0dmFyIGltYWdlID0gbmV3IFBoYXNlci5Mb2FkZXIuRmlsZVR5cGVzLkltYWdlRmlsZSh0aGlzLmxvYWRlciwga2V5LCB1cmwpO1xuXG5cdFx0XHRcdFx0aWYgKCF0aGlzLmxvYWRlci5rZXlFeGlzdHMoaW1hZ2UpKSB7XG5cdFx0XHRcdFx0XHR0aGlzLmFkZFRvTXVsdGlGaWxlKGltYWdlKTtcblx0XHRcdFx0XHRcdHRoaXMubG9hZGVyLmFkZEZpbGUoaW1hZ2UpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0fVxuXG5cdGFkZFRvQ2FjaGUgKCkge1xuXHRcdGlmICh0aGlzLmlzUmVhZHlUb1Byb2Nlc3MoKSkge1xuXHRcdFx0bGV0IHRleHR1cmVNYW5hZ2VyID0gdGhpcy5sb2FkZXIudGV4dHVyZU1hbmFnZXI7XG5cdFx0XHRmb3IgKGxldCBmaWxlIG9mIHRoaXMuZmlsZXMpIHtcblx0XHRcdFx0aWYgKGZpbGUudHlwZSA9PSBcImltYWdlXCIpIHtcblx0XHRcdFx0XHRpZiAoIXRleHR1cmVNYW5hZ2VyLmV4aXN0cyhmaWxlLmtleSkpIHtcblx0XHRcdFx0XHRcdHRleHR1cmVNYW5hZ2VyLmFkZEltYWdlKGZpbGUua2V5LCBmaWxlLmRhdGEpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHR0aGlzLnByZW11bHRpcGxpZWRBbHBoYSA9IHRoaXMucHJlbXVsdGlwbGllZEFscGhhID8/IChmaWxlLmRhdGEuaW5kZXhPZihcInBtYTogdHJ1ZVwiKSA+PSAwIHx8IGZpbGUuZGF0YS5pbmRleE9mKFwicG1hOnRydWVcIikgPj0gMCk7XG5cdFx0XHRcdFx0ZmlsZS5kYXRhID0ge1xuXHRcdFx0XHRcdFx0ZGF0YTogZmlsZS5kYXRhLFxuXHRcdFx0XHRcdFx0cHJlbXVsdGlwbGllZEFscGhhOiB0aGlzLnByZW11bHRpcGxpZWRBbHBoYSxcblx0XHRcdFx0XHR9O1xuXHRcdFx0XHRcdGZpbGUuYWRkVG9DYWNoZSgpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG59XG4iXX0=