
Diff between original: 

jhanumanthappa@IN-Jayaram2-LT ~/datagroom-ui/public/assets/vendors/InlineAttachment
$ diff inline-attachment.js ~/InlineAttachment/src/inline-attachment.js
313,316c313
<           if (/\.png$|.jpg$|.jpeg$|.gif$/.test(filename))
<             newValue = this.settings.urlText.replaceAll(this.filenameTag, filename);
<           else
<             newValue = this.settings.fileUrlText.replaceAll(this.filenameTag, filename);
---
>           newValue = this.settings.urlText.replace(this.filenameTag, filename);
364a362
>

