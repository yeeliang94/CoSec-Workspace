# Form layout review

Open `form-layout-review.html` directly in a browser, or serve it from the workspace root:

```sh
python3 -m http.server 4312 --bind 127.0.0.1 --directory prototype
```

Visit <http://127.0.0.1:4312/form-layout-review.html>.

Compare the continuous form (`?variant=flow`), section tabs (`?variant=tabs`) and guided sequence (`?variant=steps`). The bottom review bar switches layouts and example screens: Company, Job and Resolution. Left and right arrow keys also switch layouts when focus is outside form controls.

All data is fictional and held in memory. Nothing is submitted or saved. Changes survive layout switches, but refreshing resets the examples. The owner selected the guided sequence on 30 October 2026. It is the default when no variant is specified. The other layouts remain comparison references.

Validated at desktop widths of 1280px and 1440px, including navigation, editing, adding a person, review and confirmation.
