### to reference to a branch at a particular code state in tutorial docs, use tags
Create a tag:

git tag my-snapshot abc1234
git push origin my-snapshot

Then link:

https://github.com/<user>/<repo>/tree/my-snapshot

Cleaner than raw hashes, especially for sharing.