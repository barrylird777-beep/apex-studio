import hashlib
import json
import os
import unittest
from unittest.mock import patch

os.environ.update({
    "APEX_PEER_CAS_NAMESPACE": "KernelVision",
    "APEX_MODEL_ID": "test-model",
    "APEX_MODEL_REVISION": "r1",
    "APEX_PEER_CAS_BRIDGE": "http://127.0.0.1:9999",
    "APEX_PEER_CAS_TOKEN": "test-token",
})
import apex_peer_cas as loader

class PeerCASManifestTests(unittest.TestCase):
    def test_manifest_rejects_cross_namespace(self):
        with patch.object(loader, "_get", return_value=json.dumps({
            "namespace": "KashKorner", "model_id": "test-model",
            "revision": "r1", "files": [{"path": "config.json", "sha256": "a" * 64, "size": 1}]
        }).encode()):
            with self.assertRaisesRegex(RuntimeError, "identity or namespace"):
                loader.manifest()

    def test_manifest_rejects_path_traversal(self):
        with patch.object(loader, "_get", return_value=json.dumps({
            "namespace": "KernelVision", "model_id": "test-model",
            "revision": "r1", "files": [{"path": "../escape", "sha256": "a" * 64, "size": 1}]
        }).encode()):
            with self.assertRaisesRegex(RuntimeError, "Invalid Peer-CAS"):
                loader.manifest()

    def test_blob_integrity_checked_before_use(self):
        data = b"verified bytes"
        item = {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}
        with patch.object(loader, "_get", return_value=data):
            self.assertEqual(loader.file_bytes(item), data)
        with patch.object(loader, "_get", return_value=b"tampered"):
            with self.assertRaisesRegex(RuntimeError, "integrity"):
                loader.file_bytes(item)

if __name__ == "__main__":
    unittest.main()
