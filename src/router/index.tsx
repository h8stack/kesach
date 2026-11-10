import { useEffect } from "react";
import { Route, Routes, HashRouter } from "react-router-dom";
import { changeLanguage } from "../i18n";
import { ConfigService } from "../assets/lib/kookit-extra-browser.min";
import Manager from "../pages/manager";
import Stats from "../pages/stats";
import HtmlReader from "../pages/reader";
import _Redirect from "../pages/redirect";

const Router = () => {
  useEffect(() => {
    const lng = ConfigService.getReaderConfig("lang");

    if (lng) {
      //Compatile with 1.6.0 and older
      if (lng === "zh") {
        changeLanguage("zhCN");
      } else if (lng === "cht") {
        changeLanguage("zhTW");
      } else {
        changeLanguage(lng);
      }
    } else {
      ConfigService.setReaderConfig("lang", "vi");
      changeLanguage("vi");
    }
  }, []);
  return (
    <HashRouter>
      <Routes>
        <Route element={<Manager />} path="/manager/*" />
        <Route element={<Stats />} path="/stats" />
        <Route element={<HtmlReader />} path="/epub/*" />
        <Route element={<HtmlReader />} path="/mobi/*" />
        <Route element={<HtmlReader />} path="/cbr/*" />
        <Route element={<HtmlReader />} path="/cbt/*" />
        <Route element={<HtmlReader />} path="/cbz/*" />
        <Route element={<HtmlReader />} path="/cb7/*" />
        <Route element={<HtmlReader />} path="/pptx/*" />
        <Route element={<HtmlReader />} path="/ppt/*" />
        <Route element={<HtmlReader />} path="/xps/*" />
        <Route element={<HtmlReader />} path="/oxps/*" />
        <Route element={<HtmlReader />} path="/djvu/*" />
        <Route element={<HtmlReader />} path="/djv/*" />
        <Route element={<HtmlReader />} path="/ofd/*" />
        <Route element={<HtmlReader />} path="/azw3/*" />
        <Route element={<HtmlReader />} path="/azw/*" />
        <Route element={<HtmlReader />} path="/txt/*" />
        <Route element={<HtmlReader />} path="/docx/*" />
        <Route element={<HtmlReader />} path="/doc/*" />
        <Route element={<HtmlReader />} path="/rtf/*" />
        <Route element={<HtmlReader />} path="/md/*" />
        <Route element={<HtmlReader />} path="/fb2/*" />
        <Route element={<HtmlReader />} path="/chm/*" />
        <Route element={<HtmlReader />} path="/html/*" />
        <Route element={<HtmlReader />} path="/htm/*" />
        <Route element={<HtmlReader />} path="/xml/*" />
        <Route element={<HtmlReader />} path="/xhtml/*" />
        <Route element={<HtmlReader />} path="/mhtml/*" />
        <Route element={<HtmlReader />} path="/href/*" />
        <Route element={<HtmlReader />} path="/pdf/*" />
        <Route element={<_Redirect />} path="/" />
      </Routes>
    </HashRouter>
  );
};

export default Router;

