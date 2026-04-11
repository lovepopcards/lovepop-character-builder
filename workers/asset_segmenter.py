#!/usr/bin/env python3
"""
SAM 2 segmentation worker for Lovepop Asset Library.
Usage: python3 asset_segmenter.py --image <path> --model <path> --job-id <id> ...
Output: JSON to stdout with segment paths and metadata.
"""
import argparse
import json
import os
import sys
import uuid

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--source-filename', required=True)
    parser.add_argument('--min-pct', type=float, default=5.0)
    parser.add_argument('--max-pct', type=float, default=90.0)
    parser.add_argument('--confidence', type=float, default=0.88)
    parser.add_argument('--output-dir', default='/tmp/asset_segments')
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    try:
        import torch
        import numpy as np
        from PIL import Image
        from sam2.build_sam import build_sam2
        from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

        # Load model
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        # Determine config from model filename
        model_name = os.path.basename(args.model)
        if 'large' in model_name or 'hiera_l' in model_name:
            cfg = 'sam2_hiera_l.yaml'
        elif 'base_plus' in model_name:
            cfg = 'sam2_hiera_b+.yaml'
        elif 'small' in model_name:
            cfg = 'sam2_hiera_s.yaml'
        else:
            cfg = 'sam2_hiera_t.yaml'

        sam2 = build_sam2(cfg, args.model, device=device)
        mask_generator = SAM2AutomaticMaskGenerator(
            sam2,
            points_per_side=32,
            pred_iou_thresh=args.confidence,
            stability_score_thresh=0.95,
            min_mask_region_area=500,
        )

        # Load and segment image
        img = Image.open(args.image).convert('RGB')
        img_array = np.array(img)
        img_w, img_h = img.size
        img_area = img_w * img_h

        masks = mask_generator.generate(img_array)
        # Sort by area descending
        masks = sorted(masks, key=lambda m: m['area'], reverse=True)

        segments = []
        for i, mask_data in enumerate(masks):
            area = mask_data['area']
            pct = (area / img_area) * 100
            if pct < args.min_pct or pct > args.max_pct:
                continue

            # Crop to bounding box with transparency
            x, y, w, h = mask_data['bbox']
            mask = mask_data['segmentation']

            img_rgba = img.convert('RGBA')
            img_arr = np.array(img_rgba)

            # Apply mask as alpha
            alpha = (mask * 255).astype(np.uint8)
            img_arr[:, :, 3] = alpha

            # Crop to bounding box
            segment_img = Image.fromarray(img_arr[y:y+h, x:x+w], 'RGBA')

            seg_id = str(uuid.uuid4()).replace('-', '')
            out_path = os.path.join(args.output_dir, f'{seg_id}.png')
            segment_img.save(out_path, 'PNG')

            segments.append({
                'path': out_path,
                'bbox': {'x': int(x), 'y': int(y), 'w': int(w), 'h': int(h), 'pct_of_image': round(pct, 1)},
                'stability_score': float(mask_data.get('stability_score', 0)),
                'predicted_iou': float(mask_data.get('predicted_iou', 0)),
            })

        print(json.dumps({'segments': segments, 'total': len(segments)}))

    except ImportError as e:
        # SAM2 not installed — output empty segments with error info
        print(json.dumps({
            'segments': [],
            'total': 0,
            'warning': f'SAM2 not installed: {str(e)}. Install with: pip install segment-anything-2 torch torchvision Pillow numpy'
        }))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({'error': str(e), 'segments': []}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
