# Compatibility matrix (development)

| Feature | Capture | Diff | Automatic merge | Apply |
| --- | --- | --- | --- | --- |
| Layer names, visibility, opacity, fill, blend mode | Yes | Yes | Independent properties | Not yet |
| Layer order and nesting | Yes | Yes | Conservative | Not yet |
| Basic text contents | Yes | Yes | Independent edits only | Not yet |
| Pixel content | Fingerprint placeholder | Detection only | Never when both change | Not yet |
| Smart objects, effects, adjustment layers, shapes | Opaque marker | Coarse | Never when both change | Not yet |
| RGB 8-bit documents | Metadata | Yes | Metadata properties | Not yet |
| Other modes and bit depths | Detected | Warning | No | No |

The PSD snapshot remains authoritative for every unsupported property.
