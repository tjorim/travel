#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <original-image> <dist/<trip>/public/media/photo-id>" >&2
  exit 2
fi

input=$1
output_base=$2

if [[ ! -f "$input" ]]; then
  echo "Original does not exist: $input" >&2
  exit 2
fi
if [[ "$output_base" != dist/*/public/media/* ]]; then
  echo "Output must be below dist/<trip>/public/media/: $output_base" >&2
  exit 2
fi
for command in exiftool magick; do
  command -v "$command" >/dev/null || { echo "Required command not found: $command" >&2; exit 2; }
done

mkdir -p "$(dirname "$output_base")"
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
clean_image="$work_dir/clean.jpg"

# EXIFTool removes metadata before ImageMagick reads the source. ImageMagick
# strips again on output, so no GPS, camera or XMP data reaches a public file.
exiftool -all= -o "$clean_image" "$input" >/dev/null
for width in 480 960 1600; do
  magick "$clean_image" -auto-orient -resize "${width}x4800>" -strip -quality 82 "${output_base}-${width}.webp"
done

echo "Created metadata-free derivatives: ${output_base}-{480,960,1600}.webp"
