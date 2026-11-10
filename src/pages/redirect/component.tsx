import { Navigate } from "react-router-dom";

const Redirect = () => {
  return <Navigate to="/manager/home" replace />;
};

export default Redirect;
