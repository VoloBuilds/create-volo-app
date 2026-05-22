#!/bin/bash
# Cleanup test directories created by create-volo-app testing

count=0
for dir in /tmp/volo-test-*; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    echo "Removed: $dir"
    count=$((count + 1))
  fi
done

if [ $count -eq 0 ]; then
  echo "No test directories found to clean up."
else
  echo "Cleaned up $count test directory(ies)."
fi

exit 0
