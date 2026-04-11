#!/bin/bash
# Downloads SAM 2 model checkpoint for asset segmentation
# Run once during deployment setup

MODEL_DIR="./models"
mkdir -p $MODEL_DIR

echo "Downloading SAM 2 Large checkpoint (~900MB)..."
wget -O $MODEL_DIR/sam2_hiera_large.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt

echo "Downloading SAM 2 config..."
wget -O $MODEL_DIR/sam2_hiera_l.yaml \
  https://raw.githubusercontent.com/facebookresearch/segment-anything-2/main/sam2/configs/sam2/sam2_hiera_l.yaml

echo "Done. Model saved to $MODEL_DIR/"
