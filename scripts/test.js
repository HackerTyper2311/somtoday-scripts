(function () {
  'use strict';

  if (!window.SomtodayMods) {
    console.error('Somtoday Mods API is unavailable');
    return;
  }

  window.SomtodayMods.registerTab({
    id: 'example',
    label: 'Example tab',

    render: function (panel, api) {
      var heading = document.createElement('h2');
      heading.textContent = 'My custom tab';

      var description = document.createElement('p');
      description.textContent =
        'This content was added by a mod.';

      var button = document.createElement('button');
      button.textContent = 'Show enabled mods';

      var result = document.createElement('pre');

      button.addEventListener('click', function () {
        result.textContent =
          JSON.stringify(api.getEnabledMods(), null, 2);
      });

      panel.appendChild(heading);
      panel.appendChild(description);
      panel.appendChild(button);
      panel.appendChild(result);
    }
  });
})();
