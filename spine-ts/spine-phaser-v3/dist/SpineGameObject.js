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
import { SPINE_GAME_OBJECT_TYPE } from "./keys.js";
import { ComputedSizeMixin, DepthMixin, FlipMixin, ScrollFactorMixin, TransformMixin, VisibleMixin, AlphaMixin, OriginMixin, } from "./mixins.js";
import { AnimationState, AnimationStateData, MathUtils, Physics, Skeleton, SkeletonClipping, Skin, } from "@esotericsoftware/spine-core";
class BaseSpineGameObject extends Phaser.GameObjects.GameObject {
    constructor(scene, type) {
        super(scene, type);
    }
}
/** A bounds provider that provides a fixed size given by the user. */
export class AABBRectangleBoundsProvider {
    x;
    y;
    width;
    height;
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }
    calculateBounds() {
        return { x: this.x, y: this.y, width: this.width, height: this.height };
    }
}
/** A bounds provider that calculates the bounding box from the setup pose. */
export class SetupPoseBoundsProvider {
    clipping;
    /**
     * @param clipping If true, clipping attachments are used to compute the bounds. False, by default.
     */
    constructor(clipping = false) {
        this.clipping = clipping;
    }
    calculateBounds(gameObject) {
        if (!gameObject.skeleton)
            return { x: 0, y: 0, width: 0, height: 0 };
        // Make a copy of animation state and skeleton as this might be called while
        // the skeleton in the GameObject has already been heavily modified. We can not
        // reconstruct that state.
        const skeleton = new Skeleton(gameObject.skeleton.data);
        skeleton.setToSetupPose();
        skeleton.updateWorldTransform(Physics.update);
        const bounds = skeleton.getBoundsRect(this.clipping ? new SkeletonClipping() : undefined);
        return bounds.width == Number.NEGATIVE_INFINITY
            ? { x: 0, y: 0, width: 0, height: 0 }
            : bounds;
    }
}
/** A bounds provider that calculates the bounding box by taking the maximumg bounding box for a combination of skins and specific animation. */
export class SkinsAndAnimationBoundsProvider {
    animation;
    skins;
    timeStep;
    clipping;
    /**
     * @param animation The animation to use for calculating the bounds. If null, the setup pose is used.
     * @param skins The skins to use for calculating the bounds. If empty, the default skin is used.
     * @param timeStep The time step to use for calculating the bounds. A smaller time step means more precision, but slower calculation.
     * @param clipping If true, clipping attachments are used to compute the bounds. False, by default.
     */
    constructor(animation, skins = [], timeStep = 0.05, clipping = false) {
        this.animation = animation;
        this.skins = skins;
        this.timeStep = timeStep;
        this.clipping = clipping;
    }
    calculateBounds(gameObject) {
        if (!gameObject.skeleton || !gameObject.animationState)
            return { x: 0, y: 0, width: 0, height: 0 };
        // Make a copy of animation state and skeleton as this might be called while
        // the skeleton in the GameObject has already been heavily modified. We can not
        // reconstruct that state.
        const animationState = new AnimationState(gameObject.animationState.data);
        const skeleton = new Skeleton(gameObject.skeleton.data);
        const clipper = this.clipping ? new SkeletonClipping() : undefined;
        const data = skeleton.data;
        if (this.skins.length > 0) {
            let customSkin = new Skin("custom-skin");
            for (const skinName of this.skins) {
                const skin = data.findSkin(skinName);
                if (skin == null)
                    continue;
                customSkin.addSkin(skin);
            }
            skeleton.setSkin(customSkin);
        }
        skeleton.setToSetupPose();
        const animation = this.animation != null ? data.findAnimation(this.animation) : null;
        if (animation == null) {
            skeleton.updateWorldTransform(Physics.update);
            const bounds = skeleton.getBoundsRect(clipper);
            return bounds.width == Number.NEGATIVE_INFINITY
                ? { x: 0, y: 0, width: 0, height: 0 }
                : bounds;
        }
        else {
            let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
            animationState.clearTracks();
            animationState.setAnimationWith(0, animation, false);
            const steps = Math.max(animation.duration / this.timeStep, 1.0);
            for (let i = 0; i < steps; i++) {
                const delta = i > 0 ? this.timeStep : 0;
                animationState.update(delta);
                animationState.apply(skeleton);
                skeleton.update(delta);
                skeleton.updateWorldTransform(Physics.update);
                const bounds = skeleton.getBoundsRect(clipper);
                minX = Math.min(minX, bounds.x);
                minY = Math.min(minY, bounds.y);
                maxX = Math.max(maxX, bounds.x + bounds.width);
                maxY = Math.max(maxY, bounds.y + bounds.height);
            }
            const bounds = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
            };
            return bounds.width == Number.NEGATIVE_INFINITY
                ? { x: 0, y: 0, width: 0, height: 0 }
                : bounds;
        }
    }
}
/**
 * A SpineGameObject is a Phaser {@link GameObject} that can be added to a Phaser Scene and render a Spine skeleton.
 *
 * The Spine GameObject is a thin wrapper around a Spine {@link Skeleton}, {@link AnimationState} and {@link AnimationStateData}. It is responsible for:
 * - updating the animation state
 * - applying the animation state to the skeleton's bones, slots, attachments, and draw order.
 * - updating the skeleton's bone world transforms
 * - rendering the skeleton
 *
 * See the {@link SpinePlugin} class for more information on how to create a `SpineGameObject`.
 *
 * The skeleton, animation state, and animation state data can be accessed via the repsective fields. They can be manually updated via {@link updatePose}.
 *
 * To modify the bone hierarchy before the world transforms are computed, a callback can be set via the {@link beforeUpdateWorldTransforms} field.
 *
 * To modify the bone hierarchy after the world transforms are computed, a callback can be set via the {@link afterUpdateWorldTransforms} field.
 *
 * The class also features methods to convert between the skeleton coordinate system and the Phaser coordinate system.
 *
 * See {@link skeletonToPhaserWorldCoordinates}, {@link phaserWorldCoordinatesToSkeleton}, and {@link phaserWorldCoordinatesToBoneLocal.}
 */
export class SpineGameObject extends DepthMixin(OriginMixin(ComputedSizeMixin(FlipMixin(ScrollFactorMixin(TransformMixin(VisibleMixin(AlphaMixin(BaseSpineGameObject)))))))) {
    plugin;
    boundsProvider;
    blendMode = -1;
    skeleton;
    animationStateData;
    animationState;
    beforeUpdateWorldTransforms = () => { };
    afterUpdateWorldTransforms = () => { };
    premultipliedAlpha = false;
    offsetX = 0;
    offsetY = 0;
    constructor(scene, plugin, x, y, dataKey, atlasKey, boundsProvider = new SetupPoseBoundsProvider()) {
        super(scene, window.SPINE_GAME_OBJECT_TYPE ? window.SPINE_GAME_OBJECT_TYPE : SPINE_GAME_OBJECT_TYPE);
        this.plugin = plugin;
        this.boundsProvider = boundsProvider;
        this.setPosition(x, y);
        this.premultipliedAlpha = this.plugin.isAtlasPremultiplied(atlasKey);
        this.skeleton = this.plugin.createSkeleton(dataKey, atlasKey);
        this.animationStateData = new AnimationStateData(this.skeleton.data);
        this.animationState = new AnimationState(this.animationStateData);
        this.skeleton.updateWorldTransform(Physics.update);
        this.updateSize();
    }
    updateSize() {
        if (!this.skeleton)
            return;
        let bounds = this.boundsProvider.calculateBounds(this);
        this.width = bounds.width;
        this.height = bounds.height;
        this.setDisplayOrigin(-bounds.x, -bounds.y);
        this.offsetX = -bounds.x;
        this.offsetY = -bounds.y;
    }
    /** Converts a point from the skeleton coordinate system to the Phaser world coordinate system. */
    skeletonToPhaserWorldCoordinates(point) {
        let transform = this.getWorldTransformMatrix();
        let a = transform.a, b = transform.b, c = transform.c, d = transform.d, tx = transform.tx, ty = transform.ty;
        let x = point.x;
        let y = point.y;
        point.x = x * a + y * c + tx;
        point.y = x * b + y * d + ty;
    }
    /** Converts a point from the Phaser world coordinate system to the skeleton coordinate system. */
    phaserWorldCoordinatesToSkeleton(point) {
        let transform = this.getWorldTransformMatrix();
        transform = transform.invert();
        let a = transform.a, b = transform.b, c = transform.c, d = transform.d, tx = transform.tx, ty = transform.ty;
        let x = point.x;
        let y = point.y;
        point.x = x * a + y * c + tx;
        point.y = x * b + y * d + ty;
    }
    /** Converts a point from the Phaser world coordinate system to the bone's local coordinate system. */
    phaserWorldCoordinatesToBone(point, bone) {
        this.phaserWorldCoordinatesToSkeleton(point);
        if (bone.parent) {
            bone.parent.worldToLocal(point);
        }
        else {
            bone.worldToLocal(point);
        }
    }
    /**
     * Updates the {@link AnimationState}, applies it to the {@link Skeleton}, then updates the world transforms of all bones.
     * @param delta The time delta in milliseconds
     */
    updatePose(delta) {
        this.animationState.update(delta / 1000);
        this.animationState.apply(this.skeleton);
        this.beforeUpdateWorldTransforms(this);
        this.skeleton.update(delta / 1000);
        this.skeleton.updateWorldTransform(Physics.update);
        this.afterUpdateWorldTransforms(this);
    }
    preUpdate(time, delta) {
        if (!this.skeleton || !this.animationState)
            return;
        this.updatePose(delta);
    }
    preDestroy() {
        // FIXME tear down any event emitters
    }
    willRender(camera) {
        var GameObjectRenderMask = 0xf;
        var result = !this.skeleton || !(GameObjectRenderMask !== this.renderFlags || (this.cameraFilter !== 0 && this.cameraFilter & camera.id));
        if (!this.visible)
            result = false;
        if (!result && this.parentContainer && this.plugin.webGLRenderer) {
            var sceneRenderer = this.plugin.webGLRenderer;
            if (this.plugin.gl && this.plugin.phaserRenderer instanceof Phaser.Renderer.WebGL.WebGLRenderer && sceneRenderer.batcher.isDrawing) {
                sceneRenderer.end();
                this.plugin.phaserRenderer.pipelines.rebind();
            }
        }
        return result;
    }
    renderWebGL(renderer, src, camera, parentMatrix) {
        if (!this.skeleton || !this.animationState || !this.plugin.webGLRenderer)
            return;
        let sceneRenderer = this.plugin.webGLRenderer;
        if (renderer.newType) {
            renderer.pipelines.clear();
            sceneRenderer.begin();
        }
        camera.addToRenderList(src);
        let transform = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix).calc;
        let a = transform.a, b = transform.b, c = transform.c, d = transform.d, tx = transform.tx, ty = transform.ty;
        let offsetX = src.offsetX - src.displayOriginX;
        let offsetY = src.offsetY - src.displayOriginY;
        sceneRenderer.drawSkeleton(src.skeleton, src.premultipliedAlpha, -1, -1, (vertices, numVertices, stride) => {
            for (let i = 0; i < numVertices; i += stride) {
                let vx = vertices[i] + offsetX;
                let vy = vertices[i + 1] + offsetY;
                vertices[i] = vx * a + vy * c + tx;
                vertices[i + 1] = vx * b + vy * d + ty;
            }
        });
        if (!renderer.nextTypeMatch) {
            sceneRenderer.end();
            renderer.pipelines.rebind();
        }
    }
    renderCanvas(renderer, src, camera, parentMatrix) {
        if (!this.skeleton || !this.animationState || !this.plugin.canvasRenderer)
            return;
        let context = renderer.currentContext;
        let skeletonRenderer = this.plugin.canvasRenderer;
        skeletonRenderer.ctx = context;
        camera.addToRenderList(src);
        let transform = Phaser.GameObjects.GetCalcMatrix(src, camera, parentMatrix).calc;
        let skeleton = this.skeleton;
        skeleton.x = transform.tx;
        skeleton.y = transform.ty;
        skeleton.scaleX = transform.scaleX;
        skeleton.scaleY = transform.scaleY;
        let root = skeleton.getRootBone();
        root.rotation = -MathUtils.radiansToDegrees * transform.rotationNormalized;
        this.skeleton.updateWorldTransform(Physics.update);
        context.save();
        skeletonRenderer.draw(skeleton);
        context.restore();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU3BpbmVHYW1lT2JqZWN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL1NwaW5lR2FtZU9iamVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OytFQTJCK0U7QUFFL0UsT0FBTyxFQUFFLHNCQUFzQixFQUFFLE1BQU0sV0FBVyxDQUFDO0FBRW5ELE9BQU8sRUFDTixpQkFBaUIsRUFDakIsVUFBVSxFQUNWLFNBQVMsRUFDVCxpQkFBaUIsRUFDakIsY0FBYyxFQUNkLFlBQVksRUFDWixVQUFVLEVBQ1YsV0FBVyxHQUNYLE1BQU0sYUFBYSxDQUFDO0FBQ3JCLE9BQU8sRUFDTixjQUFjLEVBQ2Qsa0JBQWtCLEVBRWxCLFNBQVMsRUFDVCxPQUFPLEVBQ1AsUUFBUSxFQUNSLGdCQUFnQixFQUNoQixJQUFJLEdBRUosTUFBTSw4QkFBOEIsQ0FBQztBQUV0QyxNQUFNLG1CQUFvQixTQUFRLE1BQU0sQ0FBQyxXQUFXLENBQUMsVUFBVTtJQUM5RCxZQUFhLEtBQW1CLEVBQUUsSUFBWTtRQUM3QyxLQUFLLENBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ3BCLENBQUM7Q0FDRDtBQWFELHNFQUFzRTtBQUN0RSxNQUFNLE9BQU8sMkJBQTJCO0lBRTlCO0lBQ0E7SUFDQTtJQUNBO0lBSlQsWUFDUyxDQUFTLEVBQ1QsQ0FBUyxFQUNULEtBQWEsRUFDYixNQUFjO1FBSGQsTUFBQyxHQUFELENBQUMsQ0FBUTtRQUNULE1BQUMsR0FBRCxDQUFDLENBQVE7UUFDVCxVQUFLLEdBQUwsS0FBSyxDQUFRO1FBQ2IsV0FBTSxHQUFOLE1BQU0sQ0FBUTtJQUNuQixDQUFDO0lBQ0wsZUFBZTtRQUNkLE9BQU8sRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFB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QUcsSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUM3QixRQUFRLENBQUMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDMUIsUUFBUSxDQUFDLENBQUMsR0FBRyxTQUFTLENBQUMsRUFBRSxDQUFDO1FBQzFCLFFBQVEsQ0FBQyxNQUFNLEdBQUcsU0FBUyxDQUFDLE1BQU0sQ0FBQztRQUNuQyxRQUFRLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQyxNQUFNLENBQUM7UUFDbkMsSUFBSSxJQUFJLEdBQUcsUUFBUSxDQUFDLFdBQVcsRUFBRyxDQUFDO1FBQ25DLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLEdBQUcsU0FBUyxDQUFDLGtCQUFrQixDQUFDO1FBQzNFLElBQUksQ0FBQyxRQUFRLENBQUMsb0JBQW9CLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRW5ELE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNmLGdCQUFnQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUNoQyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDbkIsQ0FBQztDQUNEIiwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICogU3BpbmUgUnVudGltZXMgTGljZW5zZSBBZ3JlZW1lbnRcbiAqIExhc3QgdXBkYXRlZCBKdWx5IDI4LCAyMDIzLiBSZXBsYWNlcyBhbGwgcHJpb3IgdmVyc2lvbnMuXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDEzLTIwMjMsIEVzb3RlcmljIFNvZnR3YXJlIExMQ1xuICpcbiAqIEludGVncmF0aW9uIG9mIHRoZSBTcGluZSBSdW50aW1lcyBpbnRvIHNvZnR3YXJlIG9yIG90aGVyd2lzZSBjcmVhdGluZ1xuICogZGVyaXZhdGl2ZSB3b3JrcyBvZiB0aGUgU3BpbmUgUnVudGltZXMgaXMgcGVybWl0dGVkIHVuZGVyIHRoZSB0ZXJtcyBhbmRcbiAqIGNvbmRpdGlvbnMgb2YgU2VjdGlvbiAyIG9mIHRoZSBTcGluZSBFZGl0b3IgTGljZW5zZSBBZ3JlZW1lbnQ6XG4gKiBodHRwOi8vZXNvdGVyaWNzb2Z0d2FyZS5jb20vc3BpbmUtZWRpdG9yLWxpY2Vuc2VcbiAqXG4gKiBPdGhlcndpc2UsIGl0IGlzIHBlcm1pdHRlZCB0byBpbnRlZ3JhdGUgdGhlIFNwaW5lIFJ1bnRpbWVzIGludG8gc29mdHdhcmUgb3JcbiAqIG90aGVyd2lzZSBjcmVhdGUgZGVyaXZhdGl2ZSB3b3JrcyBvZiB0aGUgU3BpbmUgUnVudGltZXMgKGNvbGxlY3RpdmVseSxcbiAqIFwiUHJvZHVjdHNcIiksIHByb3ZpZGVkIHRoYXQgZWFjaCB1c2VyIG9mIHRoZSBQcm9kdWN0cyBtdXN0IG9idGFpbiB0aGVpciBvd25cbiAqIFNwaW5lIEVkaXRvciBsaWNlbnNlIGFuZCByZWRpc3RyaWJ1dGlvbiBvZiB0aGUgUHJvZHVjdHMgaW4gYW55IGZvcm0gbXVzdFxuICogaW5jbHVkZSB0aGlzIGxpY2Vuc2UgYW5kIGNvcHlyaWdodCBub3RpY2UuXG4gKlxuICogVEhFIFNQSU5FIFJVTlRJTUVTIEFSRSBQUk9WSURFRCBCWSBFU09URVJJQyBTT0ZUV0FSRSBMTEMgXCJBUyBJU1wiIEFORCBBTllcbiAqIEVYUFJFU1MgT1IgSU1QTElFRCBXQVJSQU5USUVTLCBJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgVEhFIElNUExJRURcbiAqIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBUkVcbiAqIERJU0NMQUlNRUQuIElOIE5PIEVWRU5UIFNIQUxMIEVTT1RFUklDIFNPRlRXQVJFIExMQyBCRSBMSUFCTEUgRk9SIEFOWVxuICogRElSRUNULCBJTkRJUkVDVCwgSU5DSURFTlRBTCwgU1BFQ0lBTCwgRVhFTVBMQVJZLCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVNcbiAqIChJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgUFJPQ1VSRU1FTlQgT0YgU1VCU1RJVFVURSBHT09EUyBPUiBTRVJWSUNFUyxcbiAqIEJVU0lORVNTIElOVEVSUlVQVElPTiwgT1IgTE9TUyBPRiBVU0UsIERBVEEsIE9SIFBST0ZJVFMpIEhPV0VWRVIgQ0FVU0VEIEFORFxuICogT04gQU5ZIFRIRU9SWSBPRiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlRcbiAqIChJTkNMVURJTkcgTkVHTElHRU5DRSBPUiBPVEhFUldJU0UpIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRSBPRiBUSEVcbiAqIFNQSU5FIFJVTlRJTUVTLCBFVkVOIElGIEFEVklTRUQgT0YgVEhFIFBPU1NJQklMSVRZIE9GIFNVQ0ggREFNQUdFLlxuICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG5pbXBvcnQgeyBTUElORV9HQU1FX09CSkVDVF9UWVBFIH0gZnJvbSBcIi4va2V5cy5qc1wiO1xuaW1wb3J0IHsgU3BpbmVQbHVnaW4gfSBmcm9tIFwiLi9TcGluZVBsdWdpbi5qc1wiO1xuaW1wb3J0IHtcblx0Q29tcHV0ZWRTaXplTWl4aW4sXG5cdERlcHRoTWl4aW4sXG5cdEZsaXBNaXhpbixcblx0U2Nyb2xsRmFjdG9yTWl4aW4sXG5cdFRyYW5zZm9ybU1peGluLFxuXHRWaXNpYmxlTWl4aW4sXG5cdEFscGhhTWl4aW4sXG5cdE9yaWdpbk1peGluLFxufSBmcm9tIFwiLi9taXhpbnMuanNcIjtcbmltcG9ydCB7XG5cdEFuaW1hdGlvblN0YXRlLFxuXHRBbmltYXRpb25TdGF0ZURhdGEsXG5cdEJvbmUsXG5cdE1hdGhVdGlscyxcblx0UGh5c2ljcyxcblx0U2tlbGV0b24sXG5cdFNrZWxldG9uQ2xpcHBpbmcsXG5cdFNraW4sXG5cdFZlY3RvcjIsXG59IGZyb20gXCJAZXNvdGVyaWNzb2Z0d2FyZS9zcGluZS1jb3JlXCI7XG5cbmNsYXNzIEJhc2VTcGluZUdhbWVPYmplY3QgZXh0ZW5kcyBQaGFzZXIuR2FtZU9iamVjdHMuR2FtZU9iamVjdCB7XG5cdGNvbnN0cnVjdG9yIChzY2VuZTogUGhhc2VyLlNjZW5lLCB0eXBlOiBzdHJpbmcpIHtcblx0XHRzdXBlcihzY2VuZSwgdHlwZSk7XG5cdH1cbn1cblxuLyoqIEEgYm91bmRzIHByb3ZpZGVyIGNhbGN1bGF0ZXMgdGhlIGJvdW5kaW5nIGJveCBmb3IgYSBza2VsZXRvbiwgd2hpY2ggaXMgdGhlbiBhc3NpZ25lZCBhcyB0aGUgc2l6ZSBvZiB0aGUgU3BpbmVHYW1lT2JqZWN0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTcGluZUdhbWVPYmplY3RCb3VuZHNQcm92aWRlciB7XG5cdC8vIFJldHVybnMgdGhlIGJvdW5kaW5nIGJveCBmb3IgdGhlIHNrZWxldG9uLCBpbiBza2VsZXRvbiBzcGFjZS5cblx0Y2FsY3VsYXRlQm91bmRzIChnYW1lT2JqZWN0OiBTcGluZUdhbWVPYmplY3QpOiB7XG5cdFx0eDogbnVtYmVyO1xuXHRcdHk6IG51bWJlcjtcblx0XHR3aWR0aDogbnVtYmVyO1xuXHRcdGhlaWdodDogbnVtYmVyO1xuXHR9O1xufVxuXG4vKiogQSBib3VuZHMgcHJvdmlkZXIgdGhhdCBwcm92aWRlcyBhIGZpeGVkIHNpemUgZ2l2ZW4gYnkgdGhlIHVzZXIuICovXG5leHBvcnQgY2xhc3MgQUFCQlJlY3RhbmdsZUJvdW5kc1Byb3ZpZGVyIGltcGxlbWVudHMgU3BpbmVHYW1lT2JqZWN0Qm91bmRzUHJvdmlkZXIge1xuXHRjb25zdHJ1Y3RvciAoXG5cdFx0cHJpdmF0ZSB4OiBudW1iZXIsXG5cdFx0cHJpdmF0ZSB5OiBudW1iZXIsXG5cdFx0cHJpdmF0ZSB3aWR0aDogbnVtYmVyLFxuXHRcdHByaXZhdGUgaGVpZ2h0OiBudW1iZXIsXG5cdCkgeyB9XG5cdGNhbGN1bGF0ZUJvdW5kcyAoKSB7XG5cdFx0cmV0dXJuIHsgeDogdGhpcy54LCB5OiB0aGlzLnksIHdpZHRoOiB0aGlzLndpZHRoLCBoZWlnaHQ6IHRoaXMuaGVpZ2h0IH07XG5cdH1cbn1cblxuLyoqIEEgYm91bmRzIHByb3ZpZGVyIHRoYXQgY2FsY3VsYXRlcyB0aGUgYm91bmRpbmcgYm94IGZyb20gdGhlIHNldHVwIHBvc2UuICovXG5leHBvcnQgY2xhc3MgU2V0dXBQb3NlQm91bmRzUHJvdmlkZXIgaW1wbGVtZW50cyBTcGluZUdhbWVPYmplY3RCb3VuZHNQcm92aWRlciB7XG5cdC8qKlxuXHQgKiBAcGFyYW0gY2xpcHBpbmcgSWYgdHJ1ZSwgY2xpcHBpbmcgYXR0YWNobWVudHMgYXJlIHVzZWQgdG8gY29tcHV0ZSB0aGUgYm91bmRzLiBGYWxzZSwgYnkgZGVmYXVsdC5cblx0ICovXG5cdGNvbnN0cnVjdG9yIChcblx0XHRwcml2YXRlIGNsaXBwaW5nID0gZmFsc2UsXG5cdCkgeyB9XG5cblx0Y2FsY3VsYXRlQm91bmRzIChnYW1lT2JqZWN0OiBTcGluZUdhbWVPYmplY3QpIHtcblx0XHRpZiAoIWdhbWVPYmplY3Quc2tlbGV0b24pIHJldHVybiB7IHg6IDAsIHk6IDAsIHdpZHRoOiAwLCBoZWlnaHQ6IDAgfTtcblx0XHQvLyBNYWtlIGEgY29weSBvZiBhbmltYXRpb24gc3RhdGUgYW5kIHNrZWxldG9uIGFzIHRoaXMgbWlnaHQgYmUgY2FsbGVkIHdoaWxlXG5cdFx0Ly8gdGhlIHNrZWxldG9uIGluIHRoZSBHYW1lT2JqZWN0IGhhcyBhbHJlYWR5IGJlZW4gaGVhdmlseSBtb2RpZmllZC4gV2UgY2FuIG5vdFxuXHRcdC8vIHJlY29uc3RydWN0IHRoYXQgc3RhdGUuXG5cdFx0Y29uc3Qgc2tlbGV0b24gPSBuZXcgU2tlbGV0b24oZ2FtZU9iamVjdC5za2VsZXRvbi5kYXRhKTtcblx0XHRza2VsZXRvbi5zZXRUb1NldHVwUG9zZSgpO1xuXHRcdHNrZWxldG9uLnVwZGF0ZVdvcmxkVHJhbnNmb3JtKFBoeXNpY3MudXBkYXRlKTtcblx0XHRjb25zdCBib3VuZHMgPSBza2VsZXRvbi5nZXRCb3VuZHNSZWN0KHRoaXMuY2xpcHBpbmcgPyBuZXcgU2tlbGV0b25DbGlwcGluZygpIDogdW5kZWZpbmVkKTtcblx0XHRyZXR1cm4gYm91bmRzLndpZHRoID09IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuXHRcdFx0PyB7IHg6IDAsIHk6IDAsIHdpZHRoOiAwLCBoZWlnaHQ6IDAgfVxuXHRcdFx0OiBib3VuZHM7XG5cdH1cbn1cblxuLyoqIEEgYm91bmRzIHByb3ZpZGVyIHRoYXQgY2FsY3VsYXRlcyB0aGUgYm91bmRpbmcgYm94IGJ5IHRha2luZyB0aGUgbWF4aW11bWcgYm91bmRpbmcgYm94IGZvciBhIGNvbWJpbmF0aW9uIG9mIHNraW5zIGFuZCBzcGVjaWZpYyBhbmltYXRpb24uICovXG5leHBvcnQgY2xhc3MgU2tpbnNBbmRBbmltYXRpb25Cb3VuZHNQcm92aWRlclxuXHRpbXBsZW1lbnRzIFNwaW5lR2FtZU9iamVjdEJvdW5kc1Byb3ZpZGVyIHtcblx0LyoqXG5cdCAqIEBwYXJhbSBhbmltYXRpb24gVGhlIGFuaW1hdGlvbiB0byB1c2UgZm9yIGNhbGN1bGF0aW5nIHRoZSBib3VuZHMuIElmIG51bGwsIHRoZSBzZXR1cCBwb3NlIGlzIHVzZWQuXG5cdCAqIEBwYXJhbSBza2lucyBUaGUgc2tpbnMgdG8gdXNlIGZvciBjYWxjdWxhdGluZyB0aGUgYm91bmRzLiBJZiBlbXB0eSwgdGhlIGRlZmF1bHQgc2tpbiBpcyB1c2VkLlxuXHQgKiBAcGFyYW0gdGltZVN0ZXAgVGhlIHRpbWUgc3RlcCB0byB1c2UgZm9yIGNhbGN1bGF0aW5nIHRoZSBib3VuZHMuIEEgc21hbGxlciB0aW1lIHN0ZXAgbWVhbnMgbW9yZSBwcmVjaXNpb24sIGJ1dCBzbG93ZXIgY2FsY3VsYXRpb24uXG5cdCAqIEBwYXJhbSBjbGlwcGluZyBJZiB0cnVlLCBjbGlwcGluZyBhdHRhY2htZW50cyBhcmUgdXNlZCB0byBjb21wdXRlIHRoZSBib3VuZHMuIEZhbHNlLCBieSBkZWZhdWx0LlxuXHQgKi9cblx0Y29uc3RydWN0b3IgKFxuXHRcdHByaXZhdGUgYW5pbWF0aW9uOiBzdHJpbmcgfCBudWxsLFxuXHRcdHByaXZhdGUgc2tpbnM6IHN0cmluZ1tdID0gW10sXG5cdFx0cHJpdmF0ZSB0aW1lU3RlcDogbnVtYmVyID0gMC4wNSxcblx0XHRwcml2YXRlIGNsaXBwaW5nID0gZmFsc2UsXG5cdCkgeyB9XG5cblx0Y2FsY3VsYXRlQm91bmRzIChnYW1lT2JqZWN0OiBTcGluZUdhbWVPYmplY3QpOiB7XG5cdFx0eDogbnVtYmVyO1xuXHRcdHk6IG51bWJlcjtcblx0XHR3aWR0aDogbnVtYmVyO1xuXHRcdGhlaWdodDogbnVtYmVyO1xuXHR9IHtcblx0XHRpZiAoIWdhbWVPYmplY3Quc2tlbGV0b24gfHwgIWdhbWVPYmplY3QuYW5pbWF0aW9uU3RhdGUpXG5cdFx0XHRyZXR1cm4geyB4OiAwLCB5OiAwLCB3aWR0aDogMCwgaGVpZ2h0OiAwIH07XG5cdFx0Ly8gTWFrZSBhIGNvcHkgb2YgYW5pbWF0aW9uIHN0YXRlIGFuZCBza2VsZXRvbiBhcyB0aGlzIG1pZ2h0IGJlIGNhbGxlZCB3aGlsZVxuXHRcdC8vIHRoZSBza2VsZXRvbiBpbiB0aGUgR2FtZU9iamVjdCBoYXMgYWxyZWFkeSBiZWVuIGhlYXZpbHkgbW9kaWZpZWQuIFdlIGNhbiBub3Rcblx0XHQvLyByZWNvbnN0cnVjdCB0aGF0IHN0YXRlLlxuXHRcdGNvbnN0IGFuaW1hdGlvblN0YXRlID0gbmV3IEFuaW1hdGlvblN0YXRlKGdhbWVPYmplY3QuYW5pbWF0aW9uU3RhdGUuZGF0YSk7XG5cdFx0Y29uc3Qgc2tlbGV0b24gPSBuZXcgU2tlbGV0b24oZ2FtZU9iamVjdC5za2VsZXRvbi5kYXRhKTtcblx0XHRjb25zdCBjbGlwcGVyID0gdGhpcy5jbGlwcGluZyA/IG5ldyBTa2VsZXRvbkNsaXBwaW5nKCkgOiB1bmRlZmluZWQ7XG5cdFx0Y29uc3QgZGF0YSA9IHNrZWxldG9uLmRhdGE7XG5cdFx0aWYgKHRoaXMuc2tpbnMubGVuZ3RoID4gMCkge1xuXHRcdFx0bGV0IGN1c3RvbVNraW4gPSBuZXcgU2tpbihcImN1c3RvbS1za2luXCIpO1xuXHRcdFx0Zm9yIChjb25zdCBza2luTmFtZSBvZiB0aGlzLnNraW5zKSB7XG5cdFx0XHRcdGNvbnN0IHNraW4gPSBkYXRhLmZpbmRTa2luKHNraW5OYW1lKTtcblx0XHRcdFx0aWYgKHNraW4gPT0gbnVsbCkgY29udGludWU7XG5cdFx0XHRcdGN1c3RvbVNraW4uYWRkU2tpbihza2luKTtcblx0XHRcdH1cblx0XHRcdHNrZWxldG9uLnNldFNraW4oY3VzdG9tU2tpbik7XG5cdFx0fVxuXHRcdHNrZWxldG9uLnNldFRvU2V0dXBQb3NlKCk7XG5cblx0XHRjb25zdCBhbmltYXRpb24gPVxuXHRcdFx0dGhpcy5hbmltYXRpb24gIT0gbnVsbCA/IGRhdGEuZmluZEFuaW1hdGlvbih0aGlzLmFuaW1hdGlvbiEpIDogbnVsbDtcblx0XHRpZiAoYW5pbWF0aW9uID09IG51bGwpIHtcblx0XHRcdHNrZWxldG9uLnVwZGF0ZVdvcmxkVHJhbnNmb3JtKFBoeXNpY3MudXBkYXRlKTtcblx0XHRcdGNvbnN0IGJvdW5kcyA9IHNrZWxldG9uLmdldEJvdW5kc1JlY3QoY2xpcHBlcik7XG5cdFx0XHRyZXR1cm4gYm91bmRzLndpZHRoID09IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuXHRcdFx0XHQ/IHsgeDogMCwgeTogMCwgd2lkdGg6IDAsIGhlaWdodDogMCB9XG5cdFx0XHRcdDogYm91bmRzO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRsZXQgbWluWCA9IE51bWJlci5QT1NJVElWRV9JTkZJTklUWSxcblx0XHRcdFx0bWluWSA9IE51bWJlci5QT1NJVElWRV9JTkZJTklUWSxcblx0XHRcdFx0bWF4WCA9IE51bWJlci5ORUdBVElWRV9JTkZJTklUWSxcblx0XHRcdFx0bWF4WSA9IE51bWJlci5ORUdBVElWRV9JTkZJTklUWTtcblx0XHRcdGFuaW1hdGlvblN0YXRlLmNsZWFyVHJhY2tzKCk7XG5cdFx0XHRhbmltYXRpb25TdGF0ZS5zZXRBbmltYXRpb25XaXRoKDAsIGFuaW1hdGlvbiwgZmFsc2UpO1xuXHRcdFx0Y29uc3Qgc3RlcHMgPSBNYXRoLm1heChhbmltYXRpb24uZHVyYXRpb24gLyB0aGlzLnRpbWVTdGVwLCAxLjApO1xuXHRcdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBzdGVwczsgaSsrKSB7XG5cdFx0XHRcdGNvbnN0IGRlbHRhID0gaSA+IDAgPyB0aGlzLnRpbWVTdGVwIDogMDtcblx0XHRcdFx0YW5pbWF0aW9uU3RhdGUudXBkYXRlKGRlbHRhKTtcblx0XHRcdFx0YW5pbWF0aW9uU3RhdGUuYXBwbHkoc2tlbGV0b24pO1xuXHRcdFx0XHRza2VsZXRvbi51cGRhdGUoZGVsdGEpO1xuXHRcdFx0XHRza2VsZXRvbi51cGRhdGVXb3JsZFRyYW5zZm9ybShQaHlzaWNzLnVwZGF0ZSk7XG5cblx0XHRcdFx0Y29uc3QgYm91bmRzID0gc2tlbGV0b24uZ2V0Qm91bmRzUmVjdChjbGlwcGVyKTtcblx0XHRcdFx0bWluWCA9IE1hdGgubWluKG1pblgsIGJvdW5kcy54KTtcblx0XHRcdFx0bWluWSA9IE1hdGgubWluKG1pblksIGJvdW5kcy55KTtcblx0XHRcdFx0bWF4WCA9IE1hdGgubWF4KG1heFgsIGJvdW5kcy54ICsgYm91bmRzLndpZHRoKTtcblx0XHRcdFx0bWF4WSA9IE1hdGgubWF4KG1heFksIGJvdW5kcy55ICsgYm91bmRzLmhlaWdodCk7XG5cdFx0XHR9XG5cdFx0XHRjb25zdCBib3VuZHMgPSB7XG5cdFx0XHRcdHg6IG1pblgsXG5cdFx0XHRcdHk6IG1pblksXG5cdFx0XHRcdHdpZHRoOiBtYXhYIC0gbWluWCxcblx0XHRcdFx0aGVpZ2h0OiBtYXhZIC0gbWluWSxcblx0XHRcdH07XG5cdFx0XHRyZXR1cm4gYm91bmRzLndpZHRoID09IE51bWJlci5ORUdBVElWRV9JTkZJTklUWVxuXHRcdFx0XHQ/IHsgeDogMCwgeTogMCwgd2lkdGg6IDAsIGhlaWdodDogMCB9XG5cdFx0XHRcdDogYm91bmRzO1xuXHRcdH1cblx0fVxufVxuXG4vKipcbiAqIEEgU3BpbmVHYW1lT2JqZWN0IGlzIGEgUGhhc2VyIHtAbGluayBHYW1lT2JqZWN0fSB0aGF0IGNhbiBiZSBhZGRlZCB0byBhIFBoYXNlciBTY2VuZSBhbmQgcmVuZGVyIGEgU3BpbmUgc2tlbGV0b24uXG4gKlxuICogVGhlIFNwaW5lIEdhbWVPYmplY3QgaXMgYSB0aGluIHdyYXBwZXIgYXJvdW5kIGEgU3BpbmUge0BsaW5rIFNrZWxldG9ufSwge0BsaW5rIEFuaW1hdGlvblN0YXRlfSBhbmQge0BsaW5rIEFuaW1hdGlvblN0YXRlRGF0YX0uIEl0IGlzIHJlc3BvbnNpYmxlIGZvcjpcbiAqIC0gdXBkYXRpbmcgdGhlIGFuaW1hdGlvbiBzdGF0ZVxuICogLSBhcHBseWluZyB0aGUgYW5pbWF0aW9uIHN0YXRlIHRvIHRoZSBza2VsZXRvbidzIGJvbmVzLCBzbG90cywgYXR0YWNobWVudHMsIGFuZCBkcmF3IG9yZGVyLlxuICogLSB1cGRhdGluZyB0aGUgc2tlbGV0b24ncyBib25lIHdvcmxkIHRyYW5zZm9ybXNcbiAqIC0gcmVuZGVyaW5nIHRoZSBza2VsZXRvblxuICpcbiAqIFNlZSB0aGUge0BsaW5rIFNwaW5lUGx1Z2lufSBjbGFzcyBmb3IgbW9yZSBpbmZvcm1hdGlvbiBvbiBob3cgdG8gY3JlYXRlIGEgYFNwaW5lR2FtZU9iamVjdGAuXG4gKlxuICogVGhlIHNrZWxldG9uLCBhbmltYXRpb24gc3RhdGUsIGFuZCBhbmltYXRpb24gc3RhdGUgZGF0YSBjYW4gYmUgYWNjZXNzZWQgdmlhIHRoZSByZXBzZWN0aXZlIGZpZWxkcy4gVGhleSBjYW4gYmUgbWFudWFsbHkgdXBkYXRlZCB2aWEge0BsaW5rIHVwZGF0ZVBvc2V9LlxuICpcbiAqIFRvIG1vZGlmeSB0aGUgYm9uZSBoaWVyYXJjaHkgYmVmb3JlIHRoZSB3b3JsZCB0cmFuc2Zvcm1zIGFyZSBjb21wdXRlZCwgYSBjYWxsYmFjayBjYW4gYmUgc2V0IHZpYSB0aGUge0BsaW5rIGJlZm9yZVVwZGF0ZVdvcmxkVHJhbnNmb3Jtc30gZmllbGQuXG4gKlxuICogVG8gbW9kaWZ5IHRoZSBib25lIGhpZXJhcmNoeSBhZnRlciB0aGUgd29ybGQgdHJhbnNmb3JtcyBhcmUgY29tcHV0ZWQsIGEgY2FsbGJhY2sgY2FuIGJlIHNldCB2aWEgdGhlIHtAbGluayBhZnRlclVwZGF0ZVdvcmxkVHJhbnNmb3Jtc30gZmllbGQuXG4gKlxuICogVGhlIGNsYXNzIGFsc28gZmVhdHVyZXMgbWV0aG9kcyB0byBjb252ZXJ0IGJldHdlZW4gdGhlIHNrZWxldG9uIGNvb3JkaW5hdGUgc3lzdGVtIGFuZCB0aGUgUGhhc2VyIGNvb3JkaW5hdGUgc3lzdGVtLlxuICpcbiAqIFNlZSB7QGxpbmsgc2tlbGV0b25Ub1BoYXNlcldvcmxkQ29vcmRpbmF0ZXN9LCB7QGxpbmsgcGhhc2VyV29ybGRDb29yZGluYXRlc1RvU2tlbGV0b259LCBhbmQge0BsaW5rIHBoYXNlcldvcmxkQ29vcmRpbmF0ZXNUb0JvbmVMb2NhbC59XG4gKi9cbmV4cG9ydCBjbGFzcyBTcGluZUdhbWVPYmplY3QgZXh0ZW5kcyBEZXB0aE1peGluKFxuXHRPcmlnaW5NaXhpbihcblx0XHRDb21wdXRlZFNpemVNaXhpbihcblx0XHRcdEZsaXBNaXhpbihcblx0XHRcdFx0U2Nyb2xsRmFjdG9yTWl4aW4oXG5cdFx0XHRcdFx0VHJhbnNmb3JtTWl4aW4oVmlzaWJsZU1peGluKEFscGhhTWl4aW4oQmFzZVNwaW5lR2FtZU9iamVjdCkpKVxuXHRcdFx0XHQpXG5cdFx0XHQpXG5cdFx0KVxuXHQpXG4pIHtcblx0YmxlbmRNb2RlID0gLTE7XG5cdHNrZWxldG9uOiBTa2VsZXRvbjtcblx0YW5pbWF0aW9uU3RhdGVEYXRhOiBBbmltYXRpb25TdGF0ZURhdGE7XG5cdGFuaW1hdGlvblN0YXRlOiBBbmltYXRpb25TdGF0ZTtcblx0YmVmb3JlVXBkYXRlV29ybGRUcmFuc2Zvcm1zOiAob2JqZWN0OiBTcGluZUdhbWVPYmplY3QpID0+IHZvaWQgPSAoKSA9PiB7IH07XG5cdGFmdGVyVXBkYXRlV29ybGRUcmFuc2Zvcm1zOiAob2JqZWN0OiBTcGluZUdhbWVPYmplY3QpID0+IHZvaWQgPSAoKSA9PiB7IH07XG5cdHByaXZhdGUgcHJlbXVsdGlwbGllZEFscGhhID0gZmFsc2U7XG5cdHByaXZhdGUgb2Zmc2V0WCA9IDA7XG5cdHByaXZhdGUgb2Zmc2V0WSA9IDA7XG5cblx0Y29uc3RydWN0b3IgKFxuXHRcdHNjZW5lOiBQaGFzZXIuU2NlbmUsXG5cdFx0cHJpdmF0ZSBwbHVnaW46IFNwaW5lUGx1Z2luLFxuXHRcdHg6IG51bWJlcixcblx0XHR5OiBudW1iZXIsXG5cdFx0ZGF0YUtleTogc3RyaW5nLFxuXHRcdGF0bGFzS2V5OiBzdHJpbmcsXG5cdFx0cHVibGljIGJvdW5kc1Byb3ZpZGVyOiBTcGluZUdhbWVPYmplY3RCb3VuZHNQcm92aWRlciA9IG5ldyBTZXR1cFBvc2VCb3VuZHNQcm92aWRlcigpXG5cdCkge1xuXHRcdHN1cGVyKHNjZW5lLCAod2luZG93IGFzIGFueSkuU1BJTkVfR0FNRV9PQkpFQ1RfVFlQRSA/ICh3aW5kb3cgYXMgYW55KS5TUElORV9HQU1FX09CSkVDVF9UWVBFIDogU1BJTkVfR0FNRV9PQkpFQ1RfVFlQRSk7XG5cdFx0dGhpcy5zZXRQb3NpdGlvbih4LCB5KTtcblxuXHRcdHRoaXMucHJlbXVsdGlwbGllZEFscGhhID0gdGhpcy5wbHVnaW4uaXNBdGxhc1ByZW11bHRpcGxpZWQoYXRsYXNLZXkpO1xuXHRcdHRoaXMuc2tlbGV0b24gPSB0aGlzLnBsdWdpbi5jcmVhdGVTa2VsZXRvbihkYXRhS2V5LCBhdGxhc0tleSk7XG5cdFx0dGhpcy5hbmltYXRpb25TdGF0ZURhdGEgPSBuZXcgQW5pbWF0aW9uU3RhdGVEYXRhKHRoaXMuc2tlbGV0b24uZGF0YSk7XG5cdFx0dGhpcy5hbmltYXRpb25TdGF0ZSA9IG5ldyBBbmltYXRpb25TdGF0ZSh0aGlzLmFuaW1hdGlvblN0YXRlRGF0YSk7XG5cdFx0dGhpcy5za2VsZXRvbi51cGRhdGVXb3JsZFRyYW5zZm9ybShQaHlzaWNzLnVwZGF0ZSk7XG5cdFx0dGhpcy51cGRhdGVTaXplKCk7XG5cdH1cblxuXHR1cGRhdGVTaXplICgpIHtcblx0XHRpZiAoIXRoaXMuc2tlbGV0b24pIHJldHVybjtcblx0XHRsZXQgYm91bmRzID0gdGhpcy5ib3VuZHNQcm92aWRlci5jYWxjdWxhdGVCb3VuZHModGhpcyk7XG5cdFx0dGhpcy53aWR0aCA9IGJvdW5kcy53aWR0aDtcblx0XHR0aGlzLmhlaWdodCA9IGJvdW5kcy5oZWlnaHQ7XG5cdFx0dGhpcy5zZXREaXNwbGF5T3JpZ2luKC1ib3VuZHMueCwgLWJvdW5kcy55KTtcblx0XHR0aGlzLm9mZnNldFggPSAtYm91bmRzLng7XG5cdFx0dGhpcy5vZmZzZXRZID0gLWJvdW5kcy55O1xuXHR9XG5cblx0LyoqIENvbnZlcnRzIGEgcG9pbnQgZnJvbSB0aGUgc2tlbGV0b24gY29vcmRpbmF0ZSBzeXN0ZW0gdG8gdGhlIFBoYXNlciB3b3JsZCBjb29yZGluYXRlIHN5c3RlbS4gKi9cblx0c2tlbGV0b25Ub1BoYXNlcldvcmxkQ29vcmRpbmF0ZXMgKHBvaW50OiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0pIHtcblx0XHRsZXQgdHJhbnNmb3JtID0gdGhpcy5nZXRXb3JsZFRyYW5zZm9ybU1hdHJpeCgpO1xuXHRcdGxldCBhID0gdHJhbnNmb3JtLmEsXG5cdFx0XHRiID0gdHJhbnNmb3JtLmIsXG5cdFx0XHRjID0gdHJhbnNmb3JtLmMsXG5cdFx0XHRkID0gdHJhbnNmb3JtLmQsXG5cdFx0XHR0eCA9IHRyYW5zZm9ybS50eCxcblx0XHRcdHR5ID0gdHJhbnNmb3JtLnR5O1xuXHRcdGxldCB4ID0gcG9pbnQueDtcblx0XHRsZXQgeSA9IHBvaW50Lnk7XG5cdFx0cG9pbnQueCA9IHggKiBhICsgeSAqIGMgKyB0eDtcblx0XHRwb2ludC55ID0geCAqIGIgKyB5ICogZCArIHR5O1xuXHR9XG5cblx0LyoqIENvbnZlcnRzIGEgcG9pbnQgZnJvbSB0aGUgUGhhc2VyIHdvcmxkIGNvb3JkaW5hdGUgc3lzdGVtIHRvIHRoZSBza2VsZXRvbiBjb29yZGluYXRlIHN5c3RlbS4gKi9cblx0cGhhc2VyV29ybGRDb29yZGluYXRlc1RvU2tlbGV0b24gKHBvaW50OiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0pIHtcblx0XHRsZXQgdHJhbnNmb3JtID0gdGhpcy5nZXRXb3JsZFRyYW5zZm9ybU1hdHJpeCgpO1xuXHRcdHRyYW5zZm9ybSA9IHRyYW5zZm9ybS5pbnZlcnQoKTtcblx0XHRsZXQgYSA9IHRyYW5zZm9ybS5hLFxuXHRcdFx0YiA9IHRyYW5zZm9ybS5iLFxuXHRcdFx0YyA9IHRyYW5zZm9ybS5jLFxuXHRcdFx0ZCA9IHRyYW5zZm9ybS5kLFxuXHRcdFx0dHggPSB0cmFuc2Zvcm0udHgsXG5cdFx0XHR0eSA9IHRyYW5zZm9ybS50eTtcblx0XHRsZXQgeCA9IHBvaW50Lng7XG5cdFx0bGV0IHkgPSBwb2ludC55O1xuXHRcdHBvaW50LnggPSB4ICogYSArIHkgKiBjICsgdHg7XG5cdFx0cG9pbnQueSA9IHggKiBiICsgeSAqIGQgKyB0eTtcblx0fVxuXG5cdC8qKiBDb252ZXJ0cyBhIHBvaW50IGZyb20gdGhlIFBoYXNlciB3b3JsZCBjb29yZGluYXRlIHN5c3RlbSB0byB0aGUgYm9uZSdzIGxvY2FsIGNvb3JkaW5hdGUgc3lzdGVtLiAqL1xuXHRwaGFzZXJXb3JsZENvb3JkaW5hdGVzVG9Cb25lIChwb2ludDogeyB4OiBudW1iZXI7IHk6IG51bWJlciB9LCBib25lOiBCb25lKSB7XG5cdFx0dGhpcy5waGFzZXJXb3JsZENvb3JkaW5hdGVzVG9Ta2VsZXRvbihwb2ludCk7XG5cdFx0aWYgKGJvbmUucGFyZW50KSB7XG5cdFx0XHRib25lLnBhcmVudC53b3JsZFRvTG9jYWwocG9pbnQgYXMgVmVjdG9yMik7XG5cdFx0fSBlbHNlIHtcblx0XHRcdGJvbmUud29ybGRUb0xvY2FsKHBvaW50IGFzIFZlY3RvcjIpO1xuXHRcdH1cblx0fVxuXG5cdC8qKlxuXHQgKiBVcGRhdGVzIHRoZSB7QGxpbmsgQW5pbWF0aW9uU3RhdGV9LCBhcHBsaWVzIGl0IHRvIHRoZSB7QGxpbmsgU2tlbGV0b259LCB0aGVuIHVwZGF0ZXMgdGhlIHdvcmxkIHRyYW5zZm9ybXMgb2YgYWxsIGJvbmVzLlxuXHQgKiBAcGFyYW0gZGVsdGEgVGhlIHRpbWUgZGVsdGEgaW4gbWlsbGlzZWNvbmRzXG5cdCAqL1xuXHR1cGRhdGVQb3NlIChkZWx0YTogbnVtYmVyKSB7XG5cdFx0dGhpcy5hbmltYXRpb25TdGF0ZS51cGRhdGUoZGVsdGEgLyAxMDAwKTtcblx0XHR0aGlzLmFuaW1hdGlvblN0YXRlLmFwcGx5KHRoaXMuc2tlbGV0b24pO1xuXHRcdHRoaXMuYmVmb3JlVXBkYXRlV29ybGRUcmFuc2Zvcm1zKHRoaXMpO1xuXHRcdHRoaXMuc2tlbGV0b24udXBkYXRlKGRlbHRhIC8gMTAwMCk7XG5cdFx0dGhpcy5za2VsZXRvbi51cGRhdGVXb3JsZFRyYW5zZm9ybShQaHlzaWNzLnVwZGF0ZSk7XG5cdFx0dGhpcy5hZnRlclVwZGF0ZVdvcmxkVHJhbnNmb3Jtcyh0aGlzKTtcblx0fVxuXG5cdHByZVVwZGF0ZSAodGltZTogbnVtYmVyLCBkZWx0YTogbnVtYmVyKSB7XG5cdFx0aWYgKCF0aGlzLnNrZWxldG9uIHx8ICF0aGlzLmFuaW1hdGlvblN0YXRlKSByZXR1cm47XG5cdFx0dGhpcy51cGRhdGVQb3NlKGRlbHRhKTtcblx0fVxuXG5cdHByZURlc3Ryb3kgKCkge1xuXHRcdC8vIEZJWE1FIHRlYXIgZG93biBhbnkgZXZlbnQgZW1pdHRlcnNcblx0fVxuXG5cdHdpbGxSZW5kZXIgKGNhbWVyYTogUGhhc2VyLkNhbWVyYXMuU2NlbmUyRC5DYW1lcmEpIHtcblx0XHR2YXIgR2FtZU9iamVjdFJlbmRlck1hc2sgPSAweGY7XG5cdFx0dmFyIHJlc3VsdCA9ICF0aGlzLnNrZWxldG9uIHx8ICEoR2FtZU9iamVjdFJlbmRlck1hc2sgIT09IHRoaXMucmVuZGVyRmxhZ3MgfHwgKHRoaXMuY2FtZXJhRmlsdGVyICE9PSAwICYmIHRoaXMuY2FtZXJhRmlsdGVyICYgY2FtZXJhLmlkKSk7XG5cdFx0aWYgKCF0aGlzLnZpc2libGUpIHJlc3VsdCA9IGZhbHNlO1xuXG5cdFx0aWYgKCFyZXN1bHQgJiYgdGhpcy5wYXJlbnRDb250YWluZXIgJiYgdGhpcy5wbHVnaW4ud2ViR0xSZW5kZXJlcikge1xuXHRcdFx0dmFyIHNjZW5lUmVuZGVyZXIgPSB0aGlzLnBsdWdpbi53ZWJHTFJlbmRlcmVyO1xuXG5cdFx0XHRpZiAodGhpcy5wbHVnaW4uZ2wgJiYgdGhpcy5wbHVnaW4ucGhhc2VyUmVuZGVyZXIgaW5zdGFuY2VvZiBQaGFzZXIuUmVuZGVyZXIuV2ViR0wuV2ViR0xSZW5kZXJlciAmJiBzY2VuZVJlbmRlcmVyLmJhdGNoZXIuaXNEcmF3aW5nKSB7XG5cdFx0XHRcdHNjZW5lUmVuZGVyZXIuZW5kKCk7XG5cdFx0XHRcdHRoaXMucGx1Z2luLnBoYXNlclJlbmRlcmVyLnBpcGVsaW5lcy5yZWJpbmQoKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0cmVuZGVyV2ViR0wgKFxuXHRcdHJlbmRlcmVyOiBQaGFzZXIuUmVuZGVyZXIuV2ViR0wuV2ViR0xSZW5kZXJlcixcblx0XHRzcmM6IFNwaW5lR2FtZU9iamVjdCxcblx0XHRjYW1lcmE6IFBoYXNlci5DYW1lcmFzLlNjZW5lMkQuQ2FtZXJhLFxuXHRcdHBhcmVudE1hdHJpeDogUGhhc2VyLkdhbWVPYmplY3RzLkNvbXBvbmVudHMuVHJhbnNmb3JtTWF0cml4XG5cdCkge1xuXHRcdGlmICghdGhpcy5za2VsZXRvbiB8fCAhdGhpcy5hbmltYXRpb25TdGF0ZSB8fCAhdGhpcy5wbHVnaW4ud2ViR0xSZW5kZXJlcilcblx0XHRcdHJldHVybjtcblxuXHRcdGxldCBzY2VuZVJlbmRlcmVyID0gdGhpcy5wbHVnaW4ud2ViR0xSZW5kZXJlcjtcblx0XHRpZiAocmVuZGVyZXIubmV3VHlwZSkge1xuXHRcdFx0cmVuZGVyZXIucGlwZWxpbmVzLmNsZWFyKCk7XG5cdFx0XHRzY2VuZVJlbmRlcmVyLmJlZ2luKCk7XG5cdFx0fVxuXG5cdFx0Y2FtZXJhLmFkZFRvUmVuZGVyTGlzdChzcmMpO1xuXHRcdGxldCB0cmFuc2Zvcm0gPSBQaGFzZXIuR2FtZU9iamVjdHMuR2V0Q2FsY01hdHJpeChcblx0XHRcdHNyYyxcblx0XHRcdGNhbWVyYSxcblx0XHRcdHBhcmVudE1hdHJpeFxuXHRcdCkuY2FsYztcblx0XHRsZXQgYSA9IHRyYW5zZm9ybS5hLFxuXHRcdFx0YiA9IHRyYW5zZm9ybS5iLFxuXHRcdFx0YyA9IHRyYW5zZm9ybS5jLFxuXHRcdFx0ZCA9IHRyYW5zZm9ybS5kLFxuXHRcdFx0dHggPSB0cmFuc2Zvcm0udHgsXG5cdFx0XHR0eSA9IHRyYW5zZm9ybS50eTtcblxuXHRcdGxldCBvZmZzZXRYID0gc3JjLm9mZnNldFggLSBzcmMuZGlzcGxheU9yaWdpblg7XG5cdFx0bGV0IG9mZnNldFkgPSBzcmMub2Zmc2V0WSAtIHNyYy5kaXNwbGF5T3JpZ2luWTtcblxuXHRcdHNjZW5lUmVuZGVyZXIuZHJhd1NrZWxldG9uKFxuXHRcdFx0c3JjLnNrZWxldG9uLFxuXHRcdFx0c3JjLnByZW11bHRpcGxpZWRBbHBoYSxcblx0XHRcdC0xLFxuXHRcdFx0LTEsXG5cdFx0XHQodmVydGljZXMsIG51bVZlcnRpY2VzLCBzdHJpZGUpID0+IHtcblx0XHRcdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBudW1WZXJ0aWNlczsgaSArPSBzdHJpZGUpIHtcblx0XHRcdFx0XHRsZXQgdnggPSB2ZXJ0aWNlc1tpXSArIG9mZnNldFg7XG5cdFx0XHRcdFx0bGV0IHZ5ID0gdmVydGljZXNbaSArIDFdICsgb2Zmc2V0WTtcblx0XHRcdFx0XHR2ZXJ0aWNlc1tpXSA9IHZ4ICogYSArIHZ5ICogYyArIHR4O1xuXHRcdFx0XHRcdHZlcnRpY2VzW2kgKyAxXSA9IHZ4ICogYiArIHZ5ICogZCArIHR5O1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0KTtcblxuXHRcdGlmICghcmVuZGVyZXIubmV4dFR5cGVNYXRjaCkge1xuXHRcdFx0c2NlbmVSZW5kZXJlci5lbmQoKTtcblx0XHRcdHJlbmRlcmVyLnBpcGVsaW5lcy5yZWJpbmQoKTtcblx0XHR9XG5cdH1cblxuXHRyZW5kZXJDYW52YXMgKFxuXHRcdHJlbmRlcmVyOiBQaGFzZXIuUmVuZGVyZXIuQ2FudmFzLkNhbnZhc1JlbmRlcmVyLFxuXHRcdHNyYzogU3BpbmVHYW1lT2JqZWN0LFxuXHRcdGNhbWVyYTogUGhhc2VyLkNhbWVyYXMuU2NlbmUyRC5DYW1lcmEsXG5cdFx0cGFyZW50TWF0cml4OiBQaGFzZXIuR2FtZU9iamVjdHMuQ29tcG9uZW50cy5UcmFuc2Zvcm1NYXRyaXhcblx0KSB7XG5cdFx0aWYgKCF0aGlzLnNrZWxldG9uIHx8ICF0aGlzLmFuaW1hdGlvblN0YXRlIHx8ICF0aGlzLnBsdWdpbi5jYW52YXNSZW5kZXJlcilcblx0XHRcdHJldHVybjtcblxuXHRcdGxldCBjb250ZXh0ID0gcmVuZGVyZXIuY3VycmVudENvbnRleHQ7XG5cdFx0bGV0IHNrZWxldG9uUmVuZGVyZXIgPSB0aGlzLnBsdWdpbi5jYW52YXNSZW5kZXJlcjtcblx0XHQoc2tlbGV0b25SZW5kZXJlciBhcyBhbnkpLmN0eCA9IGNvbnRleHQ7XG5cblx0XHRjYW1lcmEuYWRkVG9SZW5kZXJMaXN0KHNyYyk7XG5cdFx0bGV0IHRyYW5zZm9ybSA9IFBoYXNlci5HYW1lT2JqZWN0cy5HZXRDYWxjTWF0cml4KFxuXHRcdFx0c3JjLFxuXHRcdFx0Y2FtZXJhLFxuXHRcdFx0cGFyZW50TWF0cml4XG5cdFx0KS5jYWxjO1xuXHRcdGxldCBza2VsZXRvbiA9IHRoaXMuc2tlbGV0b247XG5cdFx0c2tlbGV0b24ueCA9IHRyYW5zZm9ybS50eDtcblx0XHRza2VsZXRvbi55ID0gdHJhbnNmb3JtLnR5O1xuXHRcdHNrZWxldG9uLnNjYWxlWCA9IHRyYW5zZm9ybS5zY2FsZVg7XG5cdFx0c2tlbGV0b24uc2NhbGVZID0gdHJhbnNmb3JtLnNjYWxlWTtcblx0XHRsZXQgcm9vdCA9IHNrZWxldG9uLmdldFJvb3RCb25lKCkhO1xuXHRcdHJvb3Qucm90YXRpb24gPSAtTWF0aFV0aWxzLnJhZGlhbnNUb0RlZ3JlZXMgKiB0cmFuc2Zvcm0ucm90YXRpb25Ob3JtYWxpemVkO1xuXHRcdHRoaXMuc2tlbGV0b24udXBkYXRlV29ybGRUcmFuc2Zvcm0oUGh5c2ljcy51cGRhdGUpO1xuXG5cdFx0Y29udGV4dC5zYXZlKCk7XG5cdFx0c2tlbGV0b25SZW5kZXJlci5kcmF3KHNrZWxldG9uKTtcblx0XHRjb250ZXh0LnJlc3RvcmUoKTtcblx0fVxufVxuIl19