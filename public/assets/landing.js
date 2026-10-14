import {$,api,applyBrand} from './common.js';
api('/api/menu').then(data=>{applyBrand(data.settings);$('#landing-name').textContent=data.settings.cafe_name;$('#landing-tagline').textContent=data.settings.tagline;document.title=`${data.settings.cafe_name} | منو`;}).catch(()=>{});
