const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('../購入した商品 - メルカリ.html', 'utf-8');
const $ = cheerio.load(html);

const items = $('div[id="item-info"]');
if(items.length > 0){
   console.log("Found item-info");
   items.each((i, el) => {
     if(i < 5) console.log($(el).text().replace(/\s+/g, ' ').trim());
   });
} else {
   console.log("no item-info, dumping all links text");
   const links = $('a');
   links.each((i, el) => {
     if(i < 50) {
       const t = $(el).text().replace(/\s+/g, ' ').trim();
       if(t.length > 5) console.log(t);
     }
   });
}
