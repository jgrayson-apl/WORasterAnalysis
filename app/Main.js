/*
  Copyright 2020 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/dom-construct",
  "esri/request",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/Slider",
  "esri/widgets/Expand",
  "Application/ApplicationParameters"
], function(calcite, declare, ApplicationBase,
            i18n, itemUtils, domHelper, domConstruct,
            esriRequest, IdentityManager, Evented, watchUtils, promiseUtils, Portal,
            ImageryLayer, RasterFunction,
            Home, Search, Slider, Expand,
            ApplicationParameters){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems);
      const firstItem = (validItems && validItems.length) ? validItems[0].value : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      // TITLE //
      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);
      document.querySelectorAll('.app-title').forEach(node => node.innerHTML = this.base.config.title);
      // DESCRIPTION //
      if(firstItem.description && firstItem.description.length){
        document.querySelectorAll('.app-description').forEach(node => node.innerHTML = firstItem.description);
      }

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-node";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(firstItem, view).then(() => {
              view.container.classList.remove("loading");
            });
          });
        });
      });
    },

    /**
     *
     * @param item
     * @param view
     */
    viewReady: function(item, view){
      return promiseUtils.create((resolve, reject) => {

        // STARTUP DIALOG //
        this.initializeStartupDialog();

        // VIEW LOADING //
        this.initializeViewLoading(view);

        // SEARCH //
        const search = new Search({ view: view, searchTerm: this.base.config.search || "" });
        const searchExpand = new Expand({
          view: view,
          content: search,
          expanded: true,
          expandIconClass: "esri-icon-search",
          expandTooltip: "Search"
        });
        view.ui.add(searchExpand, { position: "top-left", index: 0 });

        // HOME //
        const home = new Home({ view: view });
        view.ui.add(home, { position: "top-left", index: 1 });

        // PANEL TOGGLE //
        this.initializePanelToggle();

        // APPLICATION READY //
        this.applicationReady(view).then(resolve).catch(reject);

      });
    },

    /**
     *
     * @param view
     */
    initializeViewLoading: function(view){

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        updating_node.classList.toggle("is-active", updating);
      });

    },

    /**
     *
     */
    initializeStartupDialog: function(){

      // APP NAME //
      const pathParts = location.pathname.split('/');
      const appName = `show-startup-${pathParts[pathParts.length - 2]}`;

      // STARTUP DIALOG //
      const showStartup = localStorage.getItem(appName) || 'show';
      if(showStartup === 'show'){
        calcite.bus.emit('modal:open', { id: 'app-details-dialog' });
      }

      // HIDE STARTUP DIALOG //
      const hideStartupInput = document.getElementById('hide-startup-input');
      hideStartupInput.checked = (showStartup === 'hide');
      hideStartupInput.addEventListener('change', () => {
        localStorage.setItem(appName, hideStartupInput.checked ? 'hide' : 'show');
      });

    },

    /**
     *
     */
    initializePanelToggle: function(){
      const leftContainer = document.getElementById('left-container');
      const panelToggleBtn = document.getElementById('panel-toggle-btn');
      panelToggleBtn.addEventListener('click', evt => {
        leftContainer.classList.toggle('hide');
      });
    },

    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function(view){
      return promiseUtils.create((resolve, reject) => {

        //
        // RASTER ANALYSIS LAYER //
        //
        const rasterAnalysisLayer = view.map.layers.find(layer => { return (layer.title === "WO Raster Analysis"); });
        rasterAnalysisLayer.load().then(() => {
          // rasterAnalysisLayer

          // INITIAL LAYER OPACITY AND VISIBILITY //
          rasterAnalysisLayer.opacity = 1.0;
          rasterAnalysisLayer.visible = true;

          // https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
          const rasterAnalysisOpacitySlider = new Slider({
            container: 'raster-layer-opacity-slider',
            min: 0.0, max: 1.0,
            values: [rasterAnalysisLayer.opacity],
            snapOnClickEnabled: true,
            visibleElements: { labels: false, rangeLabels: false }
          });
          rasterAnalysisOpacitySlider.watch('values', values => {
            rasterAnalysisLayer.opacity = values[0];
          });

        });

        //
        // PADUS LAYER //
        //
        const padusLayer = view.map.layers.find(layer => { return (layer.title === "GAPStatus1And2"); });
        padusLayer.load().then(() => {

          // INITIAL LAYER OPACITY AND VISIBILITY //
          padusLayer.opacity = 0.0;
          padusLayer.visible = true;

          // https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
          const padusOpacitySlider = new Slider({
            container: 'padus-layer-opacity-slider',
            min: 0.0, max: 1.0,
            values: [padusLayer.opacity],
            snapOnClickEnabled: true,
            visibleElements: { labels: false, rangeLabels: false }
          });
          padusOpacitySlider.watch('values', values => {
            padusLayer.opacity = values[0];
          });
        });


        // PARAMETER SLIDERS //
        this.initializeParameterSliders().then(() => {
          // ANALYSIS //
          this.initializeAnalysis(view, rasterAnalysisLayer);

          // RESOLVE //
          resolve();
        });

      });
    },

    /**
     * https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-Slider.html
     *
     */
    initializeParameterSliders: function(){
      return promiseUtils.create((resolve, reject) => {

        // PARAMETERS CONTAINER //
        const parametersContainer = document.getElementById('parameters-container');

        // GET PARAMETER CONFIG //
        esriRequest('./config/parameters.json').then(response => {

          /**
           *  For each parameter:
           *   ...here's some general guidance for creating parameter nodes, labels, sliders, etc...
           */

          this.parameterInfos = response.data.parameters;
          this.parameterInfos.forEach(parameterInfo => {

            const paramNode = domConstruct.create('div', {
              className: 'parameter-node content-row'
            }, parametersContainer);

            const labelNode = domConstruct.create('div', {
              className: 'parameter-name font-size--3 tooltip tooltip-right tooltip-multiline',
              innerHTML: parameterInfo.label,
              'aria-label': parameterInfo.help
            }, paramNode);
            const sliderNode = domConstruct.create('div', {
              className: 'parameter-slider',
              'data-id': parameterInfo.rasterId,
            }, paramNode);
            const percentNode = domConstruct.create('div', {
              className: 'parameter-percent font-size--3 text-right',
              innerHTML: ''
            }, paramNode);

            // DEFAULT VALUE //
            const defaultValue = parameterInfo.values["GI Center Defaults"];

            // PARAMETER SLIDER //
            const parameterSlider = new Slider({
              container: sliderNode,
              min: 0, max: 100,
              precision: 0,
              snapOnClickEnabled: true,
              visibleElements: { labels: false, rangeLabels: false }
            });
            parameterSlider.watch('values', values => {
              const value = values[0];
              const hasValue = (value > 0);

              labelNode.classList.toggle('btn-disabled', !hasValue);
              percentNode.innerHTML = hasValue ? `${value}%` : '';

              // CURRENT PARAMETER WEIGHT //
              parameterInfo.weight = value;

              // NOTIFY OF WEIGHT CHANGE //
              this.emit("weight-change", { rasterId: parameterInfo.rasterId, weight: value });
            });

            // SET INITIAL VALUE //
            parameterSlider.values = [defaultValue];

            // ASSOCIATE SLIDER AND PERCENT NODE WITH PARAMETER //
            parameterInfo.slider = parameterSlider;
            parameterInfo.percentNode = percentNode;

          });

          // RESOLVE //
          resolve();
        });
      });
    },

    /**
     *
     * @param view
     * @param rasterAnalysisLayer
     */
    initializeAnalysis: function(view, rasterAnalysisLayer){

      // WEIGHT CHANGE //
      this.on("weight-change", ({ rasterId, weight }) => {
        console.info(rasterId, weight);

      });

      // PRESET SELECT //
      const presetsSelect = document.getElementById('presets-select');
      presetsSelect.addEventListener('change', () => { applyPreset() });

      // RESET BTN //
      const resetBtn = document.getElementById('reset-btn');
      resetBtn.addEventListener('click', () => { applyPreset(); });

      // APPLY BTN //
      const applyBtn = document.getElementById('apply-btn');
      applyBtn.addEventListener('click', () => { doAnalysis(); });

      // NHD INPUT //
      const nhdInput = document.getElementById('nhd-input');
      nhdInput.addEventListener('change', () => { doAnalysis(); });

      /**
       * APPLY CURRENT PRESET
       *  - GI Center Defaults
       *  - Biodiversity Defaults
       */
      const applyPreset = () => {
        this.parameterInfos.forEach(parameterInfo => {
          parameterInfo.slider.values = [parameterInfo.values[presetsSelect.value]];
        });
        doAnalysis();
      };

      /**
       *   DO ANALYSIS
       *    - BUILD UP RASTER FUNCTION HERE
       */
      const doAnalysis = () => {
        console.info('ANALYSIS LAYER: ', rasterAnalysisLayer);
        console.info('NHD OPTION: ', nhdInput.checked);

        this.parameterInfos.forEach(parameterInfo => {
          console.info('RASTER ID: ', parameterInfo.rasterId, 'WEIGHT: ', parameterInfo.weight);

          rasterAnalysisLayer.renderingRule = {
            functionName: (2 === 1) ? 'a' : 'b',
            functionParameters: {}
          };


        });
      }

    }

  });
});
